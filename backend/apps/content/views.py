from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import FaqEntry


class FaqView(APIView):
    """GET /api/content/faq/ -> the published FAQ entries, ordered. Public + tiny, so the SPA
    can fetch it without auth."""

    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        entries = [
            {"id": e.id, "question": e.question, "answer": e.answer}
            for e in FaqEntry.objects.filter(published=True)
        ]
        return Response({"entries": entries})
