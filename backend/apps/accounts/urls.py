from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MeView.as_view(), name="auth-me"),
    path("logout/", views.LogoutView.as_view(), name="auth-logout"),
    path("stats/", views.AccountStatsView.as_view(), name="account-stats"),
    path("account/", views.DeleteAccountView.as_view(), name="account-delete"),
]
