from django.urls import path

from . import views

urlpatterns = [
    path("queue/", views.QueueView.as_view(), name="clash-queue"),
    path("rooms/", views.RoomCreateView.as_view(), name="clash-room-create"),
    path("rooms/<str:code>/join/", views.RoomJoinView.as_view(), name="clash-room-join"),
]
