from django.urls import path

from . import views

urlpatterns = [
    path("runs/", views.SubmitRunView.as_view(), name="scores-submit"),
    path("leaderboard/", views.LeaderboardView.as_view(), name="scores-leaderboard"),
    path("games/", views.GamesView.as_view(), name="scores-games"),
    path("game-defaults/", views.GameDefaultsView.as_view(), name="scores-game-defaults"),
    path("daily/", views.DailyView.as_view(), name="scores-daily"),
]
