"""Clade Clash tests (#36 Phase 1). This module holds the ASGI/Channels smoke test; the
domain (distance, referee, matchmaking) gets its own tests as each lands."""
from __future__ import annotations

from channels.testing import WebsocketCommunicator
from django.test import SimpleTestCase

from cladewright.asgi import application


class HealthConsumerTests(SimpleTestCase):
    """The whole ASGI stack accepts a ws connection and round-trips JSON — proves origin
    validation, routing, connect, and receive are wired. The health consumer holds no state
    and touches no DB / channel layer, so this needs neither Redis nor a database."""

    async def test_connect_and_echo(self):
        # A browser always sends Origin; supply a valid one (in ALLOWED_HOSTS) so the CSWSH
        # validator lets the handshake through.
        communicator = WebsocketCommunicator(
            application,
            "/ws/clash/health/",
            headers=[(b"origin", b"http://localhost")],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        ready = await communicator.receive_json_from()
        self.assertEqual(ready, {"type": "ready"})

        await communicator.send_json_to({"hello": "world"})
        echo = await communicator.receive_json_from()
        self.assertEqual(echo, {"type": "echo", "payload": {"hello": "world"}})

        await communicator.disconnect()

    async def test_rejects_bad_origin(self):
        """A ws handshake with a foreign Origin is refused by AllowedHostsOriginValidator
        (CSWSH gate) before the consumer ever accepts."""
        communicator = WebsocketCommunicator(
            application,
            "/ws/clash/health/",
            headers=[(b"origin", b"http://evil.example")],
        )
        connected, _ = await communicator.connect()
        self.assertFalse(connected)
        await communicator.disconnect()
