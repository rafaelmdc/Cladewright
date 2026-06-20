from django.urls import path

from . import views

urlpatterns = [
    path("runs/", views.SubmitRunView.as_view(), name="scores-submit"),
    path("leaderboard/", views.LeaderboardView.as_view(), name="scores-leaderboard"),
]
