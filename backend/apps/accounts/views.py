"""
Minimal auth surface for the SPA. Login itself is allauth's Google flow at
``/accounts/google/login/`` (a top-level redirect); these endpoints just let the SPA
ask "who am I?" and log out, and ensure the CSRF cookie is set for authenticated POSTs.
"""
from __future__ import annotations

from django.contrib.auth import logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


@method_decorator(ensure_csrf_cookie, name="dispatch")
class MeView(APIView):
    """GET /api/auth/me/ -> the current user (and set the csrftoken cookie)."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        u = request.user
        if not u.is_authenticated:
            return Response({"authenticated": False})
        return Response(
            {"authenticated": True, "username": u.get_username(), "email": getattr(u, "email", "")}
        )


class LogoutView(APIView):
    """POST /api/auth/logout/ -> end the session."""

    permission_classes: list = []

    def post(self, request: Request) -> Response:
        logout(request)
        return Response({"authenticated": False})
