# Font Intelligence Studio — one image containing the built frontend and the
# Django server that serves it.
#
# Built from the repository root, because the frontend sources live there and
# the Django project lives in server/.

# --- Stage 1: build the studio ---------------------------------------------
FROM node:22-slim AS frontend

WORKDIR /build

# Dependencies first, so a source-only change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts ./
COPY scripts ./scripts
COPY index.html ./
COPY src ./src
COPY public ./public

# Writes server/font_studio/{static,templates}/ with asset URLs resolved
# through Django's {% static %}.
COPY server/font_studio ./server/font_studio
RUN npm run build:django


# --- Stage 2: the server ----------------------------------------------------
FROM python:3.13-slim AS server

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# psycopg[binary] ships wheels, so no build toolchain is needed here.
COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ ./

# The generated template and assets, from the frontend stage.
COPY --from=frontend /build/server/font_studio/static ./font_studio/static
COPY --from=frontend /build/server/font_studio/templates ./font_studio/templates

# Collected at build time so the running container does not need write access
# to the image, and so a broken build fails here rather than at first request.
# A throwaway key: nothing is signed during collectstatic.
RUN DJANGO_DEBUG=0 \
    DJANGO_SECRET_KEY=build-time-only \
    DJANGO_ALLOWED_HOSTS=localhost \
    python manage.py collectstatic --noinput

# Runs as a non-root user. If you mount a volume for media, make it writable
# by uid 1000.
RUN useradd --create-home --uid 1000 studio \
    && mkdir -p /app/media \
    && chown -R studio:studio /app
USER studio

EXPOSE 8000

COPY --chown=studio:studio server/docker-entrypoint.sh /usr/local/bin/entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "120", "--access-logfile", "-"]
