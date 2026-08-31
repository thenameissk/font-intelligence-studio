from django.urls import path

from . import api

app_name = "studio_api"

urlpatterns = [
    path("session/", api.whoami, name="whoami"),
    path("session/sign-in/", api.sign_in, name="sign-in"),
    path("session/sign-out/", api.sign_out, name="sign-out"),
    path("projects/", api.projects, name="projects"),
    path("projects/<int:pk>/", api.project_detail_view, name="project"),
    path("projects/<int:pk>/versions/", api.project_versions, name="versions"),
    path("library/", api.library, name="library"),
    path("library/<int:pk>/", api.library_font, name="library-font"),
]
