# Deploying to Render

Two accounts are needed: Render, and somewhere to keep uploaded fonts.
Render's free tier has no disk, and its paid disks are tied to a single
instance, so fonts go to object storage.

Everything below is something you run — I have not deployed anything or
touched any account.

---

## 1. Object storage for uploaded fonts

**Cloudflare R2** is the easiest fit: 10 GB free, no charge for egress, and
S3-compatible. AWS S3, Backblaze B2 and DigitalOcean Spaces all work the
same way.

With R2:

1. Cloudflare dashboard → **R2** → **Create bucket**. Name it e.g.
   `font-studio-media`. Keep it private.
2. **Manage R2 API Tokens** → **Create API token** → *Object Read & Write*,
   scoped to that bucket. Copy the Access Key ID and Secret Access Key —
   the secret is shown once.
3. Note your **Account ID** from the R2 overview page. Your endpoint is
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

You will paste four values into Render:

```
AWS_STORAGE_BUCKET_NAME = font-studio-media
AWS_ACCESS_KEY_ID       = …
AWS_SECRET_ACCESS_KEY   = …
AWS_S3_ENDPOINT_URL     = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

Fonts are served through signed, expiring URLs, so the bucket stays private.
Requests are signed with SigV4, which is what R2 requires — this is pinned in
settings and covered by a test, so it will not drift.

---

## 2. Push the repository

Render deploys from a Git repo, so this needs to be on GitHub or GitLab.

```bash
git init                       # if it is not a repo yet
git add .
git commit -m "Font Intelligence Studio"
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

`.gitignore` already excludes `node_modules`, the venv, `.env`, the SQLite
database, uploaded media, and the generated frontend bundle — the Docker
build regenerates that.

---

## 3. Create the services

Render dashboard → **New** → **Blueprint** → pick the repo. It reads
`render.yaml` and proposes a web service plus a Postgres database.

It will prompt for the four storage variables from step 1. Apply.

The first build takes a few minutes: it installs npm dependencies, builds
the studio, installs Python dependencies and collects static files.

---

## 4. Create your account

Once the service is live, open its **Shell** tab:

```bash
python manage.py createsuperuser
```

Then visit `https://<your-service>.onrender.com/studio/` and sign in from the
toolbar. It should change from **Local only** to your username.

Add colleagues at `/admin/` under Users. There is no public sign-up, which
is usually right for a team tool.

---

## Things to know about the free tier

- **Free web services sleep** after about 15 minutes idle and take roughly a
  minute to wake. Fine for trying it out; not fine for other people relying
  on it.
- **Free Postgres is deleted after 30 days.** Move to a paid instance before
  you have work worth keeping, or take backups.
- **Object storage is separate** and unaffected by either, which is part of
  why the fonts live there.

## If something goes wrong

**Every sign-in returns 403** — CSRF origin mismatch. `render.yaml` relies on
`RENDER_EXTERNAL_HOSTNAME`, which Render sets automatically. If you added a
custom domain, set `DJANGO_ALLOWED_HOSTS` to it as well.

**Blank page, 404s for `/static/…`** — `collectstatic` did not run or the
frontend stage failed. Check the build log for the
`Installed into server/font_studio/` line.

**Redirect loop** — `DJANGO_SECURE_SSL_REDIRECT` must stay `0` on Render.
Render already redirects HTTP to HTTPS at its router; adding Django's own
redirect on top of a proxied request loops.

**Uploads fail with a permissions error** — the R2 token needs *Object Read
& Write*, and `AWS_S3_ENDPOINT_URL` must include the account ID.

**`studio.W001` in the logs** — `DJANGO_MEDIA_BACKEND` is not set to `s3`,
so fonts are going to the container filesystem and will vanish on the next
deploy.

## One caveat I cannot resolve from here

**The Docker image has never been built.** Docker is not installed on this
machine. Every command inside the Dockerfile has been run natively and
works — the frontend build, `pip install`, `collectstatic` under
`DEBUG=False`, migrations, and gunicorn serving the hashed assets — but the
image itself is unverified.

If you have Docker locally, build it once before pushing:

```bash
docker build -t font-studio .
```

Otherwise Render's first build is the test, and its log will say plainly if
a path is wrong.
