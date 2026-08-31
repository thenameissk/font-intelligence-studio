from django.urls import path

from .views import FontStudioView

app_name = "font_studio"

urlpatterns = [
    path("", FontStudioView.as_view(), name="index"),
]
