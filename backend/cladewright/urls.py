"""Root URL config. The API is deliberately tiny — see docs/architecture.md."""
from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView

urlpatterns = [
    path("admin/", admin.site.urls),
    # Google-only login: send allauth's bare HTML login page straight to the Google flow,
    # so users never see an unstyled allauth template. Must precede the allauth include.
    path("accounts/login/", RedirectView.as_view(url="/accounts/google/login/", query_string=True)),
    path("accounts/", include("allauth.urls")),
    path("api/gamedata/", include("apps.gamedata.urls")),
    path("api/scores/", include("apps.scores.urls")),
    path("api/auth/", include("apps.accounts.urls")),
]
