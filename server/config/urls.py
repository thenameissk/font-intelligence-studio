"""
Routes for the Font Intelligence Studio server.

The studio itself is one page; everything else is the JSON API it talks to
and Django's admin.
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from .health import healthz

urlpatterns = [
    path("healthz/", healthz, name="healthz"),
    path("admin/", admin.site.urls),
    path("api/", include("studio_api.urls")),
    path("studio/", include("font_studio.urls")),
]

if settings.DEBUG:
    # Uploaded fonts. In production these are served by the web server, not
    # by Django.
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
