"""Root URL config. The API is deliberately tiny — see docs/architecture.md."""
import os

from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from django.views.generic import RedirectView

# Build stamp baked into the image at build time (see backend/Dockerfile). Lets the SPA
# footer / admin show which build is actually live, so a sync that didn't land is obvious.
APP_VERSION = os.environ.get("APP_VERSION", "dev")
BUILD_TIME = os.environ.get("BUILD_TIME", "")


def version_view(_request):
    """GET /api/version/ -> the running build's version + UTC build time. Public + tiny."""
    return JsonResponse({"version": APP_VERSION, "built": BUILD_TIME})


# Branded admin (themed via templates/admin/base_site.html + CSS variables). The build
# version is shown via the app_version context processor (see base_site.html).
admin.site.site_header = "Cladewright"
admin.site.site_title = "Cladewright admin"
admin.site.index_title = "Management"
# "View site" link: the admin runs on its own origin (dev :8000, prod a separate host),
# so a bare "/" wouldn't reach the SPA. Point it at the public site — dev defaults to the
# Vite dev server; prod sets ADMIN_SITE_URL to the real frontend URL.
admin.site.site_url = os.environ.get("ADMIN_SITE_URL", "http://localhost:5173/")

urlpatterns = [
    path("admin/", admin.site.urls),
    # Google-only login: send allauth's bare HTML login page straight to the Google flow,
    # so users never see an unstyled allauth template. Must precede the allauth include.
    path("accounts/login/", RedirectView.as_view(url="/accounts/google/login/", query_string=True)),
    path("accounts/", include("allauth.urls")),
    path("api/version/", version_view, name="app-version"),
    path("api/gamedata/", include("apps.gamedata.urls")),
    path("api/scores/", include("apps.scores.urls")),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/content/", include("apps.content.urls")),
]
