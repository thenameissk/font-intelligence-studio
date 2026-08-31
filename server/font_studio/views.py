from django.urls import NoReverseMatch, reverse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.generic import TemplateView


# The page never renders a Django form, so nothing would otherwise cause the
# csrftoken cookie to be set -- and then the first API call the client makes
# is rejected. Issuing it with the page is what lets a single-page app talk
# to Django at all.
@method_decorator(ensure_csrf_cookie, name="dispatch")
class FontStudioView(TemplateView):
    """
    Serves the studio's single page.

    There are no server-side routes inside the application: it is one page
    that manages its own state, so a single view is the whole of it.

    The page is deliberately public. The studio works with no account at all
    — fonts are parsed, edited and exported in the browser, and projects are
    kept in the visitor's own IndexedDB. Signing in adds server storage and a
    shared reference library on top of that; it is not a gate in front of the
    tool.
    """

    template_name = "font_studio/app.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        # Where the client should send API calls. Absent when studio_api is
        # not installed, in which case the studio runs purely locally and
        # never shows a sign-in control.
        try:
            context["api_root"] = reverse("studio_api:whoami").removesuffix("session/")
        except NoReverseMatch:
            context["api_root"] = ""
        return context
