#!/bin/sh
# Applies migrations, then hands off to the command.
#
# Migrating on start is right for a single-instance deployment. If you run
# several instances, move this to a release/pre-deploy step instead so they
# do not race each other.
set -e

if [ "${DJANGO_MIGRATE_ON_START:-1}" = "1" ]; then
  echo "Applying migrations…"
  python manage.py migrate --noinput
fi

exec "$@"
