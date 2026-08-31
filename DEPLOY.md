# Deploying Font Intelligence Studio

The studio is one Docker image, or one buildpack app: a Vite frontend built
into a Django project that serves it and stores work for anyone who signs in.

## Before anything else: where do the uploaded fonts go?

This is the decision that matters, and the one that is painful to get wrong.

When someone saves a project, the font they imported is uploaded and kept.
Those files are the only irreplaceable state the application has — lose them
and every project that referenced them becomes unopenable.

**Most managed hosts give each deployment a fresh filesystem.** Writing fonts
to local disk there means a redeploy silently deletes all of them. So pick
one:

| | |
|---|---|
| **Object storage** (recommended) | `DJANGO_MEDIA_BACKEND=s3` with the `AWS_*` variables. Works with AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces and MinIO. Survives redeploys and scales past one instance. |
| **A persistent volume** | Mount a disk and set `DJANGO_MEDIA_ROOT` to it. Simpler, but ties you to one instance and one host. |

`python manage.py check --deploy` warns (`studio.W001`) if you deploy with
local media, so this cannot be forgotten quietly.

## Required environment

```bash
DJANGO_SECRET_KEY=…          # python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
DJANGO_ALLOWED_HOSTS=studio.example.com
DATABASE_URL=postgres://…    # omit only if you accept SQLite
```

Everything else has a safe default. `.env.example` lists the rest.

`CSRF_TRUSTED_ORIGINS` is derived from `DJANGO_ALLOWED_HOSTS` as
`https://<host>`. Override with `DJANGO_CSRF_TRUSTED_ORIGINS` if you serve
over something else — get this wrong and every sign-in returns 403.

## With Docker

```bash
docker build -t font-studio .
docker run -p 8000:8000 \
  -e DJANGO_SECRET_KEY=… \
  -e DJANGO_ALLOWED_HOSTS=studio.example.com \
  -e DATABASE_URL=postgres://… \
  font-studio
```

The image builds the frontend, installs the server, runs `collectstatic`,
and applies migrations on start. It runs as a non-root user; if you mount a
volume for media, make it writable by uid 1000.

Set `DJANGO_MIGRATE_ON_START=0` and migrate in a release step instead if you
run more than one instance, so they do not race.

## With buildpacks

Build command:

```bash
npm ci && npm run build:django \
  && pip install -r server/requirements.txt \
  && cd server && python manage.py collectstatic --noinput
```

Start command is in the `Procfile`.

## Health check

`GET /healthz/` returns `{"status": "ok"}`, or 503 if the database is
unreachable. Point the platform's health check at it.

## After the first deploy

```bash
python manage.py createsuperuser
```

Then sign in at `/studio/` and the toolbar shows your username instead of
"Local only". The admin is at `/admin/`.

## What is verified, and what is not

Verified on this machine: the production settings, `collectstatic` with
`DEBUG=False`, running under gunicorn with WhiteNoise serving the hashed
assets, the security headers, the health endpoint, and all 20 API tests.

**Not verified:** the Docker build itself. Docker is not installed here, so
while every command in the Dockerfile has been run natively, the image has
never been built. Build it once locally before pointing a host at it.

## Notes

- Uploaded fonts are served with signed, expiring URLs when using S3
  (`AWS_QUERYSTRING_AUTH=1`, the default). Set it to `0` only if you are
  content for them to be publicly readable.
- `DJANGO_HSTS_SECONDS` defaults to one hour. Raise it once you are sure the
  domain will stay on HTTPS — browsers honour it for the full duration and
  you cannot take it back.
- There is no sign-up flow. Accounts are created through the admin or
  `createsuperuser`, which is usually what you want for a team tool.
