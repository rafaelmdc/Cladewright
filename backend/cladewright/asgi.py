"""ASGI entrypoint — one stack serves HTTP *and* websockets (#36 Phase 1).

HTTP keeps flowing through the plain Django ASGI app (DRF, admin, allauth run on the sync
surface in a threadpool). Websockets route to the Clade Clash match consumers, wrapped in:

  * ``AllowedHostsOriginValidator`` — rejects cross-site socket hijacking (CSWSH): a ws
    handshake whose Origin isn't in ``ALLOWED_HOSTS`` is refused before any auth. The HTTP
    same-origin/CORS policy has no automatic equivalent for websockets, so this is the gate.
  * ``AuthMiddlewareStack`` — populates ``scope["user"]`` from the session cookie, so a
    consumer can authenticate at connect and scope itself strictly to that connection.

Get the Django ASGI app FIRST (it calls django.setup()); only then import anything that
touches models/consumers, so app registries are ready.
"""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cladewright.settings")

# Must run before importing consumers/routing (which import models).
django_asgi_app = get_asgi_application()

from channels.auth import AuthMiddlewareStack  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402

from apps.clash.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AllowedHostsOriginValidator(
            AuthMiddlewareStack(URLRouter(websocket_urlpatterns))
        ),
    }
)
