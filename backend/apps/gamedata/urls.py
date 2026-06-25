from django.urls import path

from . import views

urlpatterns = [
    path("scopes/", views.ScopesView.as_view(), name="gamedata-scopes"),
    path("current/", views.CurrentAssetView.as_view(), name="gamedata-current"),
    path("version/", views.AssetVersionView.as_view(), name="gamedata-version"),
    # Huge-scope incremental serving (all-Animalia): autocomplete + lazy lineage fetch.
    path("search/", views.SearchView.as_view(), name="gamedata-search"),
    path("resolve/", views.ResolveView.as_view(), name="gamedata-resolve"),
    # Binary-fuse8 membership filter: the client rejects typos/out-of-scope names locally.
    path("filter/", views.FilterView.as_view(), name="gamedata-filter"),
    # Static prefix-sharded alias index: exact tail name→id lookup without the live /search.
    path("idx/", views.IndexShardView.as_view(), name="gamedata-idx"),
    # Exact alias resolution — the blob client's fallback for admin-added manual aliases.
    path("resolve-name/", views.ResolveNameView.as_view(), name="gamedata-resolve-name"),
]
