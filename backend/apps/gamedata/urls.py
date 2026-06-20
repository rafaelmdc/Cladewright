from django.urls import path

from . import views

urlpatterns = [
    path("current/", views.CurrentAssetView.as_view(), name="gamedata-current"),
    path("version/", views.AssetVersionView.as_view(), name="gamedata-version"),
]
