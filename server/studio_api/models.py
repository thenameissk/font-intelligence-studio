"""
Server-side storage for the studio.

Two things are kept here: a person's font projects, and a font library the
whole team shares. The shape mirrors what the browser stores locally, so the
same application code can talk to either.

The important property is that a project stores the imported font once and
records only the *changes* on top of it. A hundred saved versions of a three
megabyte font therefore cost kilobytes, not hundreds of megabytes.
"""

from django.conf import settings
from django.db import models


class FontProject(models.Model):
    """A font someone is working on, plus their edits to it."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="font_projects",
    )
    name = models.CharField(max_length=200, default="Untitled project")

    # The imported font, stored once. Everything else is a diff against it,
    # which is also what makes "revert to original" possible at any point.
    font_file = models.FileField(upload_to="projects/%Y/%m/")
    font_file_name = models.CharField(max_length=255)
    font_family = models.CharField(max_length=200, blank=True)
    font_size = models.PositiveIntegerField(default=0, help_text="Bytes.")

    # Sparse overlays: {glyph index: {outline, advanceWidth}} and
    # {"left,right": value}. Absent keys mean "unchanged".
    edits = models.JSONField(default=dict, blank=True)
    kerning_edits = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at",)
        indexes = [models.Index(fields=["owner", "-updated_at"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.owner})"

    @property
    def edited_glyph_count(self) -> int:
        return len(self.edits) + len(self.kerning_edits)


class ProjectVersion(models.Model):
    """
    A snapshot of a project's edits.

    Only the overlay is stored; the font itself lives on the project, so
    history is cheap enough to keep a lot of.
    """

    project = models.ForeignKey(
        FontProject, on_delete=models.CASCADE, related_name="versions"
    )
    label = models.CharField(max_length=200)
    edits = models.JSONField(default=dict, blank=True)
    kerning_edits = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="font_project_versions",
    )

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.project.name} — {self.label}"

    @property
    def edited_glyph_count(self) -> int:
        return len(self.edits)


class LibraryFont(models.Model):
    """
    A typeface in the shared reference library.

    The library is what lets the studio show how other designers draw a
    letter. It is shared across the team on purpose: a reference collection
    is more useful the more eyes have contributed to it.

    Whoever adds a face is responsible for its licence, which is why the
    uploader is recorded.
    """

    file = models.FileField(upload_to="library/")
    file_name = models.CharField(max_length=255)
    family = models.CharField(max_length=200)
    style = models.CharField(max_length=120, blank=True)

    weight_class = models.PositiveIntegerField(null=True, blank=True)
    width_class = models.PositiveIntegerField(null=True, blank=True)
    is_italic = models.BooleanField(default=False)
    outline_format = models.CharField(max_length=20, blank=True)
    units_per_em = models.PositiveIntegerField(default=1000)
    num_glyphs = models.PositiveIntegerField(default=0)

    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="library_fonts",
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("family", "style")
        constraints = [
            # The same face twice is noise in the comparison grid, not a
            # second opinion.
            models.UniqueConstraint(
                fields=["family", "style", "num_glyphs"],
                name="unique_library_face",
            )
        ]

    def __str__(self) -> str:
        return f"{self.family} {self.style}".strip()
