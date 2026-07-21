"""Matchmaking REST for Clade Clash versus (#36 Phase 1).

Thin HTTP surface over ``Matchmaking`` — the endpoints a client hits to find a duel, all
authenticated (ranked versus requires a signed-in user) and throttled (queue/room spam).
Play itself happens over the websocket the returned join token authorizes; nothing here
touches the live match beyond creating it.
"""
from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import get_or_create_profile

from .matchmaking import Matchmaker, QueueError
from .pools import load_pool, scope_key, scope_members
from .store import MatchStore, get_redis

_DEFAULT_ENGINE = "rank-depth"


def _matchmaker() -> Matchmaker:
    redis = get_redis()
    return Matchmaker(redis, store=MatchStore(redis), pool_loader=load_pool)


def _display(user) -> str:
    return get_or_create_profile(user).display_name


def _scope_of(data) -> str:
    """The requested pack(s), canonicalised (#147).

    A duel may run on a MIX, exactly as a Time Attack run can — accepted either as a list of
    keys or as a pre-joined string. Canonicalising here (sort + dedupe) is what makes the
    queue key stable: two players who picked the same two packs in a different order must
    land in the same queue, not two queues of one.
    """
    raw = (data or {}).get("scope")
    if isinstance(raw, (list, tuple)):
        return scope_key(str(s) for s in raw)
    return scope_key(scope_members(str(raw))) if raw else ""


class _ClashView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "clash_matchmaking"


class QueueView(_ClashView):
    """POST -> join the quick-match queue for (scope, engine); returns a Pairing when matched
    now or {"status":"waiting"}. GET -> poll for a pairing while waiting. DELETE -> leave."""

    def post(self, request: Request) -> Response:
        scope = _scope_of(request.data)
        if not scope:
            return Response({"detail": "scope is required"}, status=400)
        engine_id = (request.data or {}).get("engine_id", _DEFAULT_ENGINE)
        try:
            result = _matchmaker().quick_match(
                request.user.id, _display(request.user), scope=scope, engine_id=engine_id
            )
        except QueueError as e:
            return Response({"detail": str(e)}, status=409)
        payload = result.as_dict() if hasattr(result, "as_dict") else result
        return Response(payload, status=200)

    def get(self, request: Request) -> Response:
        pairing = _matchmaker().poll_pairing(request.user.id)
        return Response(pairing or {"status": "waiting"}, status=200)

    def delete(self, request: Request) -> Response:
        scope = _scope_of(request.query_params)
        engine_id = (request.query_params or {}).get("engine_id", _DEFAULT_ENGINE)
        if scope:
            _matchmaker().leave_queue(
                request.user.id, _display(request.user), scope=scope, engine_id=engine_id
            )
        return Response(status=204)


class RoomCreateView(_ClashView):
    """POST -> create a private room, returns {code}. Host then polls QueueView GET for the
    pairing once a friend joins."""

    def post(self, request: Request) -> Response:
        scope = _scope_of(request.data)
        if not scope:
            return Response({"detail": "scope is required"}, status=400)
        engine_id = (request.data or {}).get("engine_id", _DEFAULT_ENGINE)
        code = _matchmaker().create_room(
            request.user.id, _display(request.user), scope=scope, engine_id=engine_id
        )
        return Response({"code": code}, status=201)


class RoomJoinView(_ClashView):
    """POST /rooms/<code>/join/ -> join a room by code; returns the joiner's Pairing."""

    def post(self, request: Request, code: str) -> Response:
        try:
            pairing = _matchmaker().join_room(code.upper(), request.user.id, _display(request.user))
        except QueueError as e:
            return Response({"detail": str(e)}, status=404)
        return Response(pairing.as_dict(), status=200)
