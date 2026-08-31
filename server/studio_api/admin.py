from django.contrib import admin

from .models import FontProject, LibraryFont, ProjectVersion


class ProjectVersionInline(admin.TabularInline):
    model = ProjectVersion
    extra = 0
    readonly_fields = ("label", "created_at", "created_by", "edited_glyph_count")
    fields = readonly_fields
    can_delete = True

    def has_add_permission(self, request, obj=None) -> bool:
        # Snapshots are taken from the studio, not typed into the admin.
        return False


@admin.register(FontProject)
class FontProjectAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "owner",
        "font_family",
        "edited_glyph_count",
        "updated_at",
    )
    list_filter = ("owner", "updated_at")
    search_fields = ("name", "font_family", "font_file_name", "owner__username")
    readonly_fields = ("created_at", "updated_at", "edited_glyph_count")
    inlines = (ProjectVersionInline,)
    # The overlays are machine-written JSON and can be megabytes; showing
    # them in a form is a way to accidentally corrupt someone's work.
    exclude = ("edits", "kerning_edits")


@admin.register(LibraryFont)
class LibraryFontAdmin(admin.ModelAdmin):
    list_display = ("family", "style", "num_glyphs", "added_by", "added_at")
    list_filter = ("is_italic", "outline_format", "added_by")
    search_fields = ("family", "style", "file_name")
    readonly_fields = ("added_at",)
