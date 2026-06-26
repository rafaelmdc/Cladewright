from django.urls import path

from . import views

urlpatterns = [
    path("faq/", views.FaqView.as_view(), name="content-faq"),
]
