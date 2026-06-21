"""Root URL config. The API is deliberately tiny — see docs/architecture.md."""
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/", include("allauth.urls")),
    path("api/gamedata/", include("apps.gamedata.urls")),
    path("api/scores/", include("apps.scores.urls")),
    path("api/auth/", include("apps.accounts.urls")),
]
