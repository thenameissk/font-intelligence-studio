# Font Intelligence Studio — server

A Django project that serves the studio and, for anyone who signs in, keeps
their projects and a font library the team shares.

Verified against Django 6.1 on Python 3.14.

## Run it

```bash
cd server
python3 -m pip install -r requirements.txt
python3 manage.py migrate
python3 manage.py createsuperuser
python3 manage.py runserver
```

The studio is at http://127.0.0.1:8000/studio/ and the admin at `/admin/`.

The frontend is built separately, from the repository root:

```bash
npm ci
npm run build:django
```

That writes `server/font_studio/static/` and
`server/font_studio/templates/`. Re-run it after any frontend change.

## What signing in changes

The studio works fully without an account. Fonts are parsed, analysed,
edited and exported in the browser; projects live in that browser's
IndexedDB; nothing is uploaded. The toolbar says **Local only** when this is
the case.

Signing in changes two things, and the toolbar then shows your username:

- **Projects are stored on the server.** The imported font is uploaded once
  and the edits are saved as a sparse overlay on top of it, so autosave
  costs a few kilobytes rather than re-uploading a multi-megabyte font.
  Version snapshots store the overlay only.
- **The reference library is shared.** Every signed-in user sees the same
  typefaces, so the "how do other designers draw this letter" comparison
  draws on everything the team has collected. A face can be removed by
  whoever added it, or by staff.

Switching between the two never destroys anything: signing out returns you
to this browser's own storage and leaves the server's copy alone.

## Layout

```
server/
  config/          settings, root urls
  font_studio/     serves the page (generated static + template)
  studio_api/      models, JSON API, admin
```

`font_studio` is self-contained and can be lifted into another Django
project on its own — see FONT_STUDIO_APP.md. Without `studio_api` installed
it simply never offers sign-in and the studio runs locally.

## The API

Session-authenticated, CSRF-protected, JSON. Ten endpoints under `/api/`:

| | |
|---|---|
| `GET session/` | who is signed in; anonymous is a normal answer |
| `POST session/sign-in/`, `POST session/sign-out/` | |
| `GET, POST projects/` | list yours; create one with a font upload |
| `GET, PATCH, DELETE projects/<id>/` | load, save the overlay, remove |
| `GET, POST projects/<id>/versions/` | snapshots |
| `GET, POST library/` | the shared library |
| `DELETE library/<id>/` | uploader or staff only |

A project belongs to one person. Someone else's returns 404 rather than 403,
so the API does not confirm that an id exists to a user who cannot see it.

Run the tests with `python3 manage.py test studio_api`.

## Before deploying

- **`DEBUG = False`, and set `ALLOWED_HOSTS` and a real `SECRET_KEY`.** The
  generated settings are development defaults.
- **Move off SQLite.** Edit overlays are JSON columns and can be a few
  megabytes on a heavily edited font; PostgreSQL handles that far better.
- **Serve `MEDIA_ROOT` from your web server or object storage.** Django
  serves uploads only while `DEBUG` is on. Uploaded fonts are currently
  readable by anyone who knows the URL — put them behind authenticated
  access if that matters to you.
- **Check the licence position.** The shared library holds other people's
  typefaces, and the studio lets a designer borrow a drawing from one. That
  is a decision for your team; the studio records who uploaded each face and
  says so at the point of use.
- **There are per-request limits** on font size (32 MB) and overlay size
  (24 MB), in `studio_api/api.py`.
