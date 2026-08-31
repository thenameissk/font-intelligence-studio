"""
JSON shapes.

These deliberately mirror the records the browser keeps locally, so the same
frontend code can read either without translating between two vocabularies.
Keys are camelCase because that is what the client speaks.
"""

from __future__ import annotations

from typing import Any

from .models import FontProject, LibraryFont, ProjectVersion


def project_summary(project: FontProject) -> dict[str, Any]:
    """A project without its overlays, for listings."""
    return {
        "id": str(project.pk),
        "name": project.name,
        "fontFileName": project.font_file_name,
        "fontFamily": project.font_family,
        "fontSize": project.font_size,
        "editedGlyphs": project.edited_glyph_count,
        "createdAt": project.created_at.timestamp() * 1000,
        "updatedAt": project.updated_at.timestamp() * 1000,
    }


def project_detail(project: FontProject) -> dict[str, Any]:
    """
    A project with its overlays and a URL for the font itself.

    The font is referenced rather than inlined: it is the one large thing
    here, it never changes, and the browser can cache it.
    """
    return {
        **project_summary(project),
        "fontUrl": project.font_file.url,
        "edits": project.edits,
        "kerningEdits": project.kerning_edits,
    }


def version_record(version: ProjectVersion) -> dict[str, Any]:
    return {
        "id": str(version.pk),
        "projectId": str(version.project_id),
        "label": version.label,
        "edits": version.edits,
        "kerningEdits": version.kerning_edits,
        "editedGlyphs": version.edited_glyph_count,
        "createdAt": version.created_at.timestamp() * 1000,
        "createdBy": version.created_by.get_username() if version.created_by else None,
    }


def library_entry(font: LibraryFont) -> dict[str, Any]:
    return {
        "id": str(font.pk),
        "family": font.family,
        "style": font.style,
        "fileName": font.file_name,
        "fontUrl": font.file.url,
        "weightClass": font.weight_class,
        "widthClass": font.width_class,
        "isItalic": font.is_italic,
        "outlineFormat": font.outline_format,
        "unitsPerEm": font.units_per_em,
        "numGlyphs": font.num_glyphs,
        "addedBy": font.added_by.get_username() if font.added_by else None,
        "addedAt": font.added_at.timestamp() * 1000,
    }
