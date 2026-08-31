from django.apps import AppConfig


class FontStudioConfig(AppConfig):
    """
    Font Intelligence Studio.

    The studio is a client-side application: font parsing, analysis, editing
    and export all happen in the browser, and no font data is sent to the
    server. Django's job here is to serve the page and its assets, which is
    why this app has no models and no migrations.
    """

    name = "font_studio"
    verbose_name = "Font Intelligence Studio"
    default_auto_field = "django.db.models.BigAutoField"
