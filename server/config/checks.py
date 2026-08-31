"""
Deployment checks specific to this application.

Django's own `check --deploy` covers the generic hazards. These cover the
one that is particular to a font studio: the uploaded fonts are the only
irreplaceable state here, and the usual way to lose them is to deploy to a
platform with an ephemeral filesystem without noticing.
"""

from django.conf import settings
from django.core.checks import Error, Warning, register


@register(deploy=True)
def media_storage_is_durable(app_configs, **kwargs):
    """
    Warns when uploaded fonts are being written to local disk in production.

    Most managed hosts give each deployment a fresh filesystem. Local media
    there means every redeploy silently deletes every font anyone uploaded,
    and the projects that referenced them become unopenable. Either point
    DJANGO_MEDIA_BACKEND at S3-compatible storage, or attach a persistent
    volume and set DJANGO_MEDIA_ROOT to it.
    """
    if settings.DEBUG:
        return []
    if getattr(settings, "MEDIA_BACKEND", "local") == "s3":
        return []

    return [
        Warning(
            "Uploaded fonts are stored on the local filesystem.",
            hint=(
                "If this host has an ephemeral filesystem, every redeploy will "
                "delete every uploaded font and break the projects that use "
                "them. Set DJANGO_MEDIA_BACKEND=s3 with the AWS_* settings, or "
                "mount a persistent volume and point DJANGO_MEDIA_ROOT at it. "
                "If DJANGO_MEDIA_ROOT is already on a durable volume, you can "
                "silence this with SILENCED_SYSTEM_CHECKS."
            ),
            id="studio.W001",
        )
    ]


@register(deploy=True)
def s3_storage_is_configured(app_configs, **kwargs):
    """S3 selected but half-configured fails at the first upload, not at boot."""
    if getattr(settings, "MEDIA_BACKEND", "local") != "s3":
        return []

    options = settings.STORAGES["default"].get("OPTIONS", {})
    missing = [
        name
        for name, key in (
            ("AWS_STORAGE_BUCKET_NAME", "bucket_name"),
            ("AWS_ACCESS_KEY_ID", "access_key"),
            ("AWS_SECRET_ACCESS_KEY", "secret_key"),
        )
        if not options.get(key)
    ]
    if not missing:
        return []

    return [
        Error(
            "S3 media storage is selected but incompletely configured.",
            hint=f"Missing: {', '.join(missing)}.",
            id="studio.E001",
        )
    ]


@register(deploy=True)
def hosts_are_named(app_configs, **kwargs):
    """A deployment that trusts no host serves 400 to everybody."""
    if settings.DEBUG or settings.ALLOWED_HOSTS:
        return []
    return [
        Error(
            "DJANGO_ALLOWED_HOSTS is empty.",
            hint="Set it to the domain(s) this will be served from, comma separated.",
            id="studio.E002",
        )
    ]
