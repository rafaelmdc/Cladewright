from django.urls import path

from . import views

urlpatterns = [
    path("current/", views.CurrentAssetView.as_view(), name="gamedata-current"),
    path("version/", views.AssetVersionView.as_view(), name="gamedata-version"),
    # Huge-scope incremental serving (all-Animalia): autocomplete + lazy lineage fetch.
    path("search/", views.SearchView.as_view(), name="gamedata-search"),
    path("resolve/", views.ResolveView.as_view(), name="gamedata-resolve"),
]
