"""
A liveness endpoint for the platform's health checks.

Deliberately cheap and unauthenticated: it confirms the process is up and
can reach the database, which is what a load balancer needs to decide
whether to send traffic here. It reports nothing about the deployment that
would be useful to anyone else.
"""

from django.db import connection
from django.http import JsonResponse


def healthz(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        # No detail in the response: a health endpoint is a public surface.
        return JsonResponse({"status": "unhealthy"}, status=503)
    return JsonResponse({"status": "ok"})
