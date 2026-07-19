"""Clade Clash websocket consumers (#36 Phase 1).

The realtime match consumer (referee for a versus duel) lands in a later step. For now this
holds a tiny ``HealthConsumer`` that proves the whole ASGI/Channels stack is wired: origin
validation, routing, connect, and the channel layer are all exercised by a round-trip echo.
"""
from __future__ import annotations

from channels.generic.websocket import AsyncJsonWebsocketConsumer


class HealthConsumer(AsyncJsonWebsocketConsumer):
    """Accepts a ws connection and echoes JSON back, tagged. A liveness probe for the ASGI
    deployment (and the smoke test for the Channels wiring). Carries no auth or state."""

    async def connect(self) -> None:
        await self.accept()
        await self.send_json({"type": "ready"})

    async def receive_json(self, content: dict, **kwargs) -> None:
        await self.send_json({"type": "echo", "payload": content})
