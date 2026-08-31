# For hosts that use buildpacks rather than a Dockerfile (Render, Railway,
# Heroku). Build the frontend and collect static in the build command:
#
#   npm ci && npm run build:django && cd server \
#     && pip install -r requirements.txt \
#     && python manage.py collectstatic --noinput
#
release: cd server && python manage.py migrate --noinput
web: cd server && gunicorn config.wsgi:application --bind 0.0.0.0:$PORT --workers 3 --timeout 120 --access-logfile -
