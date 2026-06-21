"""Root URL config. The API is deliberately tiny — see docs/architecture.md."""
import os

from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView

# Branded admin (themed via templates/admin/base_site.html + CSS variables).
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
    path("api/gamedata/", include("apps.gamedata.urls")),
    path("api/scores/", include("apps.scores.urls")),
    path("api/auth/", include("apps.accounts.urls")),
]
