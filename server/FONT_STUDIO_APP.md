# Font Intelligence Studio as a Django app

`font_studio/` is a self-contained, reusable Django application. It has no
models, no migrations and no database use: the studio parses, analyses, edits
and exports fonts entirely in the browser, and stores projects in the
visitor's own IndexedDB. Django's job is to serve one page and its assets.

Verified against Django 6.1 on Python 3.14.

## Install

1. **Build the assets.** From the repository root:

   ```bash
   npm ci
   npm run build:django
   ```

   This writes `django/font_studio/static/font_studio/` and
   `django/font_studio/templates/font_studio/app.html`. The template resolves
   every asset through `{% static %}`, so it keeps working under a CDN or
   `ManifestStaticFilesStorage`.

2. **Copy the app** into your project, next to your other apps:

   ```bash
   cp -R django/font_studio /path/to/your/project/
   ```

3. **Register it** in `settings.py`:

   ```python
   INSTALLED_APPS = [
       # …
       "django.contrib.staticfiles",
       "font_studio",
   ]
   ```

4. **Route it** in your root `urls.py`:

   ```python
   from django.urls import include, path

   urlpatterns = [
       # …
       path("fonts/", include("font_studio.urls")),
   ]
   ```

   Any prefix works, including `""` for the site root. The studio has no
   client-side routing, so it needs exactly one URL and no catch-all.

5. **Collect static** for production as usual:

   ```bash
   python manage.py collectstatic
   ```

The studio is then at `/fonts/`, and reversible as `font_studio:index`.

## Rebuilding

Re-run `npm run build:django` and copy `font_studio/static/` and
`font_studio/templates/` across again. The build clears the static directory
first, so old hashed chunks do not accumulate.

The generated output is not committed to this repository — the Vite source is
the source of truth. Build it before deploying, or commit the two generated
directories in *your* project if you would rather deploy without Node.

## Things worth knowing before you deploy

**The base path is baked in at build time.** `build-django.mjs` builds with
`base=/static/font_studio/`. If your `STATIC_URL` is not `/static/`, the
`{% static %}` tags still resolve correctly — but if you serve static from a
different *path prefix* you should rebuild with a matching `VITE_BASE`.

**There is an inline script in the template.** It reads the saved theme
before first paint so the shell never flashes the wrong colours. Under a
strict Content-Security-Policy you will need a nonce or a hash for it, or you
can delete that `<script>` block and accept a brief flash.

**Web Workers and dynamic imports are used heavily.** Validation runs in a
worker; the typography, kerning, QA, export, tracing and WOFF2 code all load
on demand. Django's `staticfiles` serves these correctly with no extra
configuration — this was verified end to end, including a WOFF2 export, which
pulls a 1 MB WebAssembly chunk.

**Nothing is uploaded.** If you want server-side projects, shared libraries or
accounts, that is a backend the studio does not currently have — the storage
layer is IndexedDB and would need replacing with an API.

## What the app contains

```
font_studio/
  apps.py                      no models, no migrations
  urls.py                      one route
  views.py                     a TemplateView
  templates/font_studio/       generated: app.html
  static/font_studio/          generated: hashed JS/CSS + favicon
```
