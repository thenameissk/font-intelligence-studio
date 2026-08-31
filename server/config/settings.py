"""
Settings for the Font Intelligence Studio server.

Everything that differs between a laptop and a deployment is read from the
environment, so the same code runs in both and nothing secret lives in the
repository. Defaults are the *safe* ones: DEBUG is off and the secret key is
required unless you say otherwise, because a settings file that is insecure
by default eventually ships that way.

For local work, copy .env.example to .env and run as usual.
"""

from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

def _load_dotenv(path: Path) -> dict[str, str]:
    """
    Reads a .env file into a plain dict.

    Deliberately tiny and dependency-free: KEY=value, # comments, optional
    surrounding quotes. Real environment variables always win, so a
    deployment's settings cannot be overridden by a stray file.
    """
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


import os  # noqa: E402  (after the loader, so the intent above reads first)

_FILE_ENV = _load_dotenv(BASE_DIR / ".env")


def env(key: str, default: str | None = None) -> str | None:
    return os.environ.get(key, _FILE_ENV.get(key, default))


def env_bool(key: str, default: bool = False) -> bool:
    raw = env(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(key: str, default: str = "") -> list[str]:
    return [item.strip() for item in (env(key, default) or "").split(",") if item.strip()]


# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------

DEBUG = env_bool("DJANGO_DEBUG", False)

SECRET_KEY = env("DJANGO_SECRET_KEY") or ""
if not SECRET_KEY:
    if DEBUG:
        # Ephemeral, so sessions do not survive a restart. That is a
        # nuisance locally and a disaster in production, which is exactly
        # why this branch is unreachable when DEBUG is off.
        from django.core.management.utils import get_random_secret_key

        SECRET_KEY = get_random_secret_key()
    else:
        raise RuntimeError(
            "DJANGO_SECRET_KEY must be set when DEBUG is off. "
            "Generate one with: python -c \"from django.core.management.utils "
            'import get_random_secret_key; print(get_random_secret_key())"'
        )

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]" if DEBUG else "")

# Render publishes the service's own hostname. Adding it automatically means
# a first deploy answers requests instead of returning 400 to everything
# while you work out why.
if render_host := env("RENDER_EXTERNAL_HOSTNAME"):
    if render_host not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(render_host)

# Django requires the scheme here, and requires it for any HTTPS deployment
# or every POST is rejected — which would show up as sign-in failing with no
# obvious cause. Derived from ALLOWED_HOSTS unless set outright.
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS") or [
    f"https://{host}"
    for host in ALLOWED_HOSTS
    if not host.startswith((".", "[", "localhost", "127."))
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # The studio: one app serves the page, the other stores work.
    "font_studio",
    "studio_api",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Serves static files straight from the app server, so a deployment
    # needs no separate web server in front of it.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

# SQLite locally; DATABASE_URL (Postgres) anywhere real. Edit overlays are
# JSON columns that can run to megabytes on a heavily edited font, which
# SQLite tolerates and Postgres handles properly.
DATABASES = {
    "default": dj_database_url.parse(
        env("DATABASE_URL") or f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
        conn_health_checks=True,
    )
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# ---------------------------------------------------------------------------
# Internationalisation
# ---------------------------------------------------------------------------

LANGUAGE_CODE = "en-us"
TIME_ZONE = env("DJANGO_TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True


# ---------------------------------------------------------------------------
# Static and media
# ---------------------------------------------------------------------------

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("DJANGO_MEDIA_ROOT") or (BASE_DIR / "media"))

# Uploaded fonts are the one piece of irreplaceable state this application
# has. On a platform with an ephemeral filesystem, storing them on local
# disk means every redeploy silently destroys everybody's projects — so the
# storage backend is an explicit choice, and config/checks.py complains
# loudly if the risky one is left in place in production.
MEDIA_BACKEND = (env("DJANGO_MEDIA_BACKEND", "local") or "local").lower()

if MEDIA_BACKEND == "s3":
    _s3_options = {
        "bucket_name": env("AWS_STORAGE_BUCKET_NAME"),
        "access_key": env("AWS_ACCESS_KEY_ID"),
        "secret_key": env("AWS_SECRET_ACCESS_KEY"),
        "region_name": env("AWS_S3_REGION_NAME", "auto"),
        # Set for any S3-compatible host: Cloudflare R2, Backblaze B2,
        # DigitalOcean Spaces, MinIO. Leave unset for AWS itself.
        "endpoint_url": env("AWS_S3_ENDPOINT_URL") or None,
        "default_acl": None,
        "querystring_auth": env_bool("AWS_QUERYSTRING_AUTH", True),
        # Never overwrite: two projects that both imported "Helvetica.ttf"
        # must not end up sharing one object.
        "file_overwrite": False,
        # Cloudflare R2 accepts only SigV4, and it is the current scheme on
        # AWS too. Without pinning it boto can fall back to SigV2 and every
        # request to R2 is rejected.
        "signature_version": env("AWS_S3_SIGNATURE_VERSION", "s3v4"),
    }
    if custom_domain := env("AWS_S3_CUSTOM_DOMAIN"):
        _s3_options["custom_domain"] = custom_domain

    MEDIA_STORAGE = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {k: v for k, v in _s3_options.items() if v is not None},
    }
else:
    MEDIA_STORAGE = {"BACKEND": "django.core.files.storage.FileSystemStorage"}

STORAGES = {
    "default": MEDIA_STORAGE,
    "staticfiles": {
        # Hashes and compresses static files, and serves them with far-future
        # caching. The studio's assets are already content-hashed by Vite;
        # this makes Django's own admin assets behave the same way.
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

WHITENOISE_MAX_AGE = 31536000  # A year: every asset filename is hashed.


# ---------------------------------------------------------------------------
# Uploads
# ---------------------------------------------------------------------------

# Fonts arrive as multipart. The API caps a single font at 32 MB; this stops
# anything larger being buffered before it is rejected.
DATA_UPLOAD_MAX_MEMORY_SIZE = 32 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024
DATA_UPLOAD_MAX_NUMBER_FIELDS = 5000


# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------

LOGIN_URL = "/studio/"

if not DEBUG:
    # Behind a load balancer or PaaS router, the request reaches Django over
    # plain HTTP with the original scheme in a header. Without this Django
    # thinks every request is insecure and redirects forever.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

    SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

    # Start HSTS short. A long max-age is hard to undo: browsers remember it
    # and will refuse plain HTTP for that long even if you need them to.
    SECURE_HSTS_SECONDS = int(env("DJANGO_HSTS_SECONDS", "3600") or 0)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("DJANGO_HSTS_INCLUDE_SUBDOMAINS", False)
    SECURE_HSTS_PRELOAD = env_bool("DJANGO_HSTS_PRELOAD", False)

    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"
    X_FRAME_OPTIONS = "DENY"

    SESSION_COOKIE_SAMESITE = "Lax"
    CSRF_COOKIE_SAMESITE = "Lax"


# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------

# Nothing sends email yet; the console backend keeps `check --deploy` quiet
# about a development default that is not actually in use.
EMAIL_BACKEND = env(
    "DJANGO_EMAIL_BACKEND",
    "django.core.mail.backends.console.EmailBackend"
    if DEBUG
    else "django.core.mail.backends.dummy.EmailBackend",
)


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"simple": {"format": "{levelname} {name} {message}", "style": "{"}},
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "simple"},
    },
    "root": {"handlers": ["console"], "level": env("DJANGO_LOG_LEVEL", "INFO")},
    "loggers": {
        "django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False},
    },
}

# Registers the deployment checks in config/checks.py.
from config import checks as _checks  # noqa: E402,F401
