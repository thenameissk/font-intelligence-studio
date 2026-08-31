"""
The studio's HTTP API.

Small enough to write against Django directly: ten endpoints over two
models, session authentication, and no content negotiation to speak of. A
REST framework would add a dependency and a layer of indirection without
removing any of the work that actually matters here, which is validating
what the client sends.
"""

from __future__ import annotations

import json
from typing import Any, Callable

from django.contrib.auth import authenticate, login, logout
from django.db import IntegrityError, transaction
from django.http import (
    HttpRequest,
    HttpResponse,
    HttpResponseNotAllowed,
    JsonResponse,
)
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods

from .models import FontProject, LibraryFont, ProjectVersion
from .serializers import (
    library_entry,
    project_detail,
    project_summary,
    version_record,
)

# A font that will not fit in memory in the browser is not a font this
# application can open, so there is no point accepting it.
MAX_FONT_BYTES = 32 * 1024 * 1024

# The overlay is the only thing a client can grow without bound. This is
# generous -- a fully redrawn 3,000 glyph font is well inside it -- while
# still refusing something pathological.
MAX_OVERLAY_BYTES = 24 * 1024 * 1024

ALLOWED_FONT_SUFFIXES = (".ttf", ".otf", ".woff", ".woff2", ".ttc")


class ApiError(Exception):
    """An error with a status code, rendered as JSON rather than HTML."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def api(view: Callable[..., Any]) -> Callable[..., HttpResponse]:
    """Turns ApiError into JSON and requires a signed-in user."""

    def wrapped(request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        if not request.user.is_authenticated:
            return JsonResponse(
                {"error": "Sign in to use server storage."}, status=401
            )
        try:
            return view(request, *args, **kwargs)
        except ApiError as error:
            return JsonResponse({"error": error.message}, status=error.status)

    wrapped.__name__ = view.__name__
    return wrapped


def read_json(request: HttpRequest) -> dict[str, Any]:
    if len(request.body) > MAX_OVERLAY_BYTES:
        raise ApiError("That payload is too large to store.", status=413)
    try:
        data = json.loads(request.body or b"{}")
    except json.JSONDecodeError as error:
        raise ApiError(f"Malformed JSON: {error}") from error
    if not isinstance(data, dict):
        raise ApiError("Expected a JSON object.")
    return data


def check_overlay(value: Any, field: str) -> dict[str, Any]:
    """Overlays must be objects, and must not be enormous."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ApiError(f"'{field}' must be an object.")
    if len(json.dumps(value)) > MAX_OVERLAY_BYTES:
        raise ApiError(f"'{field}' is too large to store.", status=413)
    return value


def check_font_upload(uploaded: Any) -> None:
    if uploaded is None:
        raise ApiError("A font file is required.")
    if uploaded.size > MAX_FONT_BYTES:
        raise ApiError("That font is larger than 32 MB.", status=413)
    name = (uploaded.name or "").lower()
    if not name.endswith(ALLOWED_FONT_SUFFIXES):
        raise ApiError(
            "Expected a TTF, OTF, WOFF, WOFF2 or TTC file.",
        )


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------


@require_http_methods(["GET"])
def whoami(request: HttpRequest) -> JsonResponse:
    """
    Who is signed in, if anyone.

    Called once at boot so the studio knows whether server storage is
    available. An anonymous answer is normal, not an error: the application
    works entirely locally without an account.
    """
    user = request.user
    return JsonResponse(
        {
            "authenticated": user.is_authenticated,
            "username": user.get_username() if user.is_authenticated else None,
            "isStaff": bool(getattr(user, "is_staff", False)),
        }
    )


@require_http_methods(["POST"])
def sign_in(request: HttpRequest) -> JsonResponse:
    data = read_json(request)
    user = authenticate(
        request,
        username=data.get("username", ""),
        password=data.get("password", ""),
    )
    if user is None:
        return JsonResponse({"error": "Wrong username or password."}, status=401)
    login(request, user)
    return JsonResponse({"authenticated": True, "username": user.get_username()})


@require_http_methods(["POST"])
def sign_out(request: HttpRequest) -> JsonResponse:
    logout(request)
    return JsonResponse({"authenticated": False})


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------


def owned(request: HttpRequest, pk: str) -> FontProject:
    """A project belonging to the caller. Anyone else's is simply not found."""
    return get_object_or_404(FontProject, pk=pk, owner=request.user)


@api
def projects(request: HttpRequest) -> HttpResponse:
    if request.method == "GET":
        found = FontProject.objects.filter(owner=request.user)
        return JsonResponse(
            {"projects": [project_summary(p) for p in found]}
        )

    if request.method == "POST":
        uploaded = request.FILES.get("font")
        check_font_upload(uploaded)

        project = FontProject.objects.create(
            owner=request.user,
            name=request.POST.get("name") or "Untitled project",
            font_file=uploaded,
            font_file_name=uploaded.name,
            font_family=request.POST.get("fontFamily", "")[:200],
            font_size=uploaded.size,
            edits=check_overlay(
                json.loads(request.POST.get("edits") or "{}"), "edits"
            ),
            kerning_edits=check_overlay(
                json.loads(request.POST.get("kerningEdits") or "{}"),
                "kerningEdits",
            ),
        )
        return JsonResponse(project_detail(project), status=201)

    return HttpResponseNotAllowed(["GET", "POST"])


@api
def project_detail_view(request: HttpRequest, pk: str) -> HttpResponse:
    project = owned(request, pk)

    if request.method == "GET":
        return JsonResponse(project_detail(project))

    if request.method in ("PATCH", "PUT"):
        data = read_json(request)
        if "name" in data:
            project.name = str(data["name"])[:200]
        if "edits" in data:
            project.edits = check_overlay(data["edits"], "edits")
        if "kerningEdits" in data:
            project.kerning_edits = check_overlay(
                data["kerningEdits"], "kerningEdits"
            )
        project.save()
        return JsonResponse(project_detail(project))

    if request.method == "DELETE":
        project.delete()
        return JsonResponse({"deleted": True})

    return HttpResponseNotAllowed(["GET", "PATCH", "PUT", "DELETE"])


@api
def project_versions(request: HttpRequest, pk: str) -> HttpResponse:
    project = owned(request, pk)

    if request.method == "GET":
        return JsonResponse(
            {"versions": [version_record(v) for v in project.versions.all()]}
        )

    if request.method == "POST":
        data = read_json(request)
        version = ProjectVersion.objects.create(
            project=project,
            label=str(data.get("label") or "Snapshot")[:200],
            edits=check_overlay(data.get("edits"), "edits"),
            kerning_edits=check_overlay(data.get("kerningEdits"), "kerningEdits"),
            created_by=request.user,
        )
        return JsonResponse(version_record(version), status=201)

    return HttpResponseNotAllowed(["GET", "POST"])


# ---------------------------------------------------------------------------
# Shared library
# ---------------------------------------------------------------------------


@api
def library(request: HttpRequest) -> HttpResponse:
    if request.method == "GET":
        return JsonResponse(
            {"fonts": [library_entry(f) for f in LibraryFont.objects.all()]}
        )

    if request.method == "POST":
        uploaded = request.FILES.get("font")
        check_font_upload(uploaded)

        def number(key: str) -> int | None:
            raw = request.POST.get(key)
            try:
                return int(raw) if raw not in (None, "", "null") else None
            except ValueError:
                return None

        family = request.POST.get("family", "")[:200] or uploaded.name
        style = request.POST.get("style", "")[:120]
        num_glyphs = number("numGlyphs") or 0

        # Adding a face that is already there is not an error: the caller
        # wanted it in the library, and it is. Hand back the existing one.
        existing = LibraryFont.objects.filter(
            family=family, style=style, num_glyphs=num_glyphs
        ).first()
        if existing is not None:
            return JsonResponse(library_entry(existing), status=200)

        try:
            # The check above is a fast path, not a lock. Two uploads racing
            # still hit the constraint, and the insert needs its own
            # savepoint or the failure poisons the surrounding transaction
            # and every later query in the request dies with it.
            with transaction.atomic():
                font = LibraryFont.objects.create(
                    file=uploaded,
                    file_name=uploaded.name,
                    family=family,
                    style=style,
                    weight_class=number("weightClass"),
                    width_class=number("widthClass"),
                    is_italic=request.POST.get("isItalic") == "true",
                    outline_format=request.POST.get("outlineFormat", "")[:20],
                    units_per_em=number("unitsPerEm") or 1000,
                    num_glyphs=num_glyphs,
                    added_by=request.user,
                )
        except IntegrityError:
            raced = LibraryFont.objects.filter(
                family=family, style=style, num_glyphs=num_glyphs
            ).first()
            if raced is None:
                raise ApiError("That face could not be added.", status=409)
            return JsonResponse(library_entry(raced), status=200)

        return JsonResponse(library_entry(font), status=201)

    return HttpResponseNotAllowed(["GET", "POST"])


@api
@require_http_methods(["DELETE"])
def library_font(request: HttpRequest, pk: str) -> HttpResponse:
    font = get_object_or_404(LibraryFont, pk=pk)
    # A shared library that anyone can quietly empty is not shared, it is
    # shared-until-someone-makes-a-mistake.
    if font.added_by_id != request.user.pk and not request.user.is_staff:
        raise ApiError(
            "Only the person who added this face, or an administrator, can remove it.",
            status=403,
        )
    font.delete()
    return JsonResponse({"deleted": True})
