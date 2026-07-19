# Clade Clash — game design

**Phase 0 (solo vs bot) + Phase 1 (realtime versus) built.** The design of record for
Cladewright's distance-guessing mode: given a specimen, pick which of two neighbours
is its closer relative. Shipped **solo (vs a bot)** — client-side, unranked — then a
**realtime 1v1** over websockets (server-refereed, ranked), the first concrete use of the
multiplayer substrate sketched in [`lobby-and-config.md`](lobby-and-config.md) and #103/#76.

Roadmap, phased rollout, and open decisions live in the tracking issue **#36**
(this repo's convention: docs describe the design + invariants; schedules live in
issues). This doc is the *why* and the invariants any implementation must hold.

Player-facing name: **Clade Clash**. Internal mode keys follow the existing
`<base>_<cadence>` pattern (cf. `marathon_free`) — e.g. `clash_solo`, `clash_versus`;
pick them deliberately, they anchor data and routes (see
[`games-model.md`](games-model.md)).

## The loop

> One specimen sits in the middle; a candidate neighbour sits on each side, face
> down. Pick the closer relative. In versus, each player locks in — your card
> animates but reads "?" to your opponent — and both flanks flip to reveal when
> **both** lock in *or* the round timer expires.

- **One judgement per round: "is Y or Z the closer relative of X?"** That makes a
  round instant to render and instant to grade — the property everything else leans on.
- **Reveal teaches.** The flip shows the answer *and the shared clade* — "*Leopard*
  shares family *Felidae*; *wolf* only shares order *Carnivora*" — so a round leaves
  you knowing something, not just scored.
- **Health, not points (GeoGuessr-Duels-style).** Both sides start at `HP_MAX` (100).
  Each round is a **difference model**: only the side whose outcome *differs* from the
  other takes damage — if you pick the closer relative and your opponent doesn't, they
  bleed; if you both get it right (or both wrong) nobody does. First to 0 HP is
  eliminated. Damage **scales with how obvious the round was** — a wide-gap round (genus
  vs class) hits harder than a subtle one — so missing a gimme costs more than missing a
  close call. The exact `damage(gap)` curve is owned by the distance engine (below).
- **Scopes and lobby are Time Attack's — no new scope concept.** A match runs on the
  same packs and the same admin-built pack sets / pre-chosen mixes as
  [`marathon-design.md`](marathon-design.md), picked in the lobby exactly like Marathon
  (reuse asset loading, the scope picker, and the mix/merge pipeline verbatim; lobby =
  Marathon's config panel plus player invites, see
  [`lobby-and-config.md`](lobby-and-config.md)). The round generator simply samples its
  centre + two candidates **from within the chosen scope**.
- **A bot opponent** is a first-class feature, not just a demo stub: it powers solo
  practice and lets the full three-card versus flow work before any socket exists.

## The distance signal (the core design decision)

### What the asset gives us

Topology only. Each tip carries its `lineage` (ordered root→parent ancestor node
ids); each node carries a taxonomic `rank` and a `depth`
([`game-asset-format.md`](game-asset-format.md)). There are **no branch lengths and
no sequences** — so anything genetic is *new data*, not a query.

### The metric: a pluggable distance engine

What "closer relative" *means* is deliberately swappable. Phase 0 ships a
`DistanceEngine` seam (`frontend/src/lib/game/cladeClash.ts`) so the metric can change
— shared-clade depth today, nodal edges or genetic divergence later — without touching
the game loop. An engine is four things over the shared `relatedness()` primitive
(`frontend/src/lib/game/distance.ts`):

- `relate(asset, a, b)` — the `Relatedness` of two tips (MRCA index + rank, shared
  ancestor depth, and nodal edge distance), used for grading and the reveal copy.
- `closeness(r)` — a scalar where **bigger = more closely related**, in whatever units
  the engine likes. The generator ranks and gaps candidates on this.
- `minGap` — the minimum closeness gap for a round to count as fair (below).
- `damage(gap)` — health lost for missing a round of that gap, in the engine's own units.

Because `closeness`, `minGap` and `damage` all speak the same units, an engine is
self-consistent and interchangeable. Two ship:

- **`rankDepthEngine` (default).** `closeness = sharedDepth` — rank by how *deep* the
  shared clade is (genus beats family beats order). Topology-only, no branch lengths.
- **`nodalEngine`.** `closeness = −nodal` — fewer edges between the tips = closer. Same
  reveal and game, a different notion of "closer", here to prove the seam is real.

Raw edge-count on a unit-length cladogram is coarse and tie-heavy (the "kind of bad"
about node distance). **The fix is the round generator, not a fancier metric:**

- **Generate for a clear gap.** The near candidate is drawn at maximum `closeness` to
  the centre; the far one must be at least `minGap` less close. The answer is then
  unambiguous by construction, and `gap = closeness(near) − closeness(far)` sizes both
  difficulty and damage.
- **Never ask a coin-flip in ranked play.** If no candidate clears `minGap`, discard the
  centre and redraw (`ATTEMPTS` tries, then the caller falls back).

### Invariants

- **`relatedness()` is a shared primitive.** Nodal distance + MRCA rank, mirrored client
  and server, is exactly the signal the deferred modifiers **#126** (distance-decay)
  and **#127** (vicinity) also need. Built once as standalone infra
  (`frontend/src/lib/game/distance.ts`); all three — and every `DistanceEngine` — consume it.
- **The server is authoritative for the answer.** It computes the correct side from
  `lineage`; the client is never *told* which side is correct (it can *derive* it —
  see Security). This mirrors the run re-score posture in `apps/scores/scoring.py`.

### The path to a real metric (post-MVP)

When rank-gap rounds start to feel samey, upgrade the *data*, not the game: have the
pipeline emit branch lengths or a per-scope distance matrix into the asset. Braidworks
already ships `gtdb_weaver` (branch-length trees), `ncbi_weaver`, and `uniprot_weaver`,
so patristic / sequence-divergence distance is a pipeline extension. The game loop and
the `distance()` signature don't change; only what fills them in does.

## Realtime architecture (versus)

**Built (Phase 1).** The app now runs one ASGI stack, reusing the Redis already deployed as
the Celery broker ([`deployment.md`](deployment.md)) — that was the whole substrate.

- **One ASGI stack** — gunicorn with a uvicorn worker (`-k uvicorn.workers.UvicornWorker`,
  see `backend/Dockerfile`) serves HTTP *and* websockets from one image. Django 6 runs the
  sync surface (DRF, admin, allauth) in a threadpool. Chosen over a WSGI/ASGI split for
  maintainability; still *splittable by route later* (same image, two deployments) if
  sockets ever contend with the API.
- **Django Channels + channels-redis.** Websocket consumers live on `/ws/clash/…`
  (`apps/clash/consumers.py`, routed in `apps/clash/routing.py`). A **Redis channel layer**
  (isolated from Celery by a distinct DB index + key prefix) fans out match-room messages, so
  no sticky sessions are needed.
- **Ephemeral match state in Redis** (`apps/clash/store.py`: one JSON blob per match — centre,
  candidates, deadline, lock-ins, round, each side's HP) with a **TTL**, so an abandoned match
  self-expires. **Durable outcome in Postgres** — a `MatchResult` row (`apps/clash/models.py`)
  written at settle, the way finished runs persist.
- **Concurrency.** A live match is a read-modify-write on its Redis state, serialized per
  match by a **combined lock** (`apps/clash/runtime.py`): a process-local `asyncio` lock *and*
  a **Redis distributed lock** (`SET NX`), so two players on *different* pods/workers can't
  interleave a resolve either. One code path is correct from a single pod up to a
  horizontally-scaled ws tier. (The homelab still runs `replicas: 1` + `WEB_CONCURRENCY=1`
  because ~50 players fit one async process easily — but that's now a sizing choice, not a
  correctness constraint. The Redis half auto-disables where the client can't lock, e.g. the
  in-memory test fakes.)

### Invariants

- **The server is the referee.** The ws consumer validates lock-ins, owns the
  countdown, and decides the reveal moment (both-locked *or* deadline). Clients render
  a local timer for feel only.
- **No peer-to-peer.** Players never connect to each other — all traffic is
  server-mediated. Every cross-player effect passes through the referee, where it is
  gradeable and blockable. (This is what makes user isolation achievable; see Security.)

### Match lifecycle

1. **Queue** — a player asks to duel; dropped on a Redis matchmaking queue (or invited
   directly via a room code).
2. **Pair & seed** — two players pop → a match id is minted, first round's state written
   to Redis, both sockets joined to the room group.
3. **Play a round** — lock-ins arrive as ws messages; the consumer records each to Redis
   and echoes only an opaque "opponent locked" (never the pick) to the room.
4. **Reveal** — on both-locked or deadline, the consumer grades against the server-side
   distance, broadcasts the flip + result, and advances the round.
5. **Settle** — after the last round, write `MatchResult` to Postgres; let the Redis
   state expire.

### Scale

Websockets are cheap and payloads tiny. 50 concurrent players ≈ 25 matches ≈ ≤50
sockets → one ASGI pod covers it; k8s replicas + the Redis channel layer give headroom
to hundreds. k8s delta: the existing web Deployment swaps its command to uvicorn workers
and gains Channels; the existing Redis is reused as the channel layer. No new datastore.

## Security model (invariants to preserve)

**Integrity here is not secrecy of the answer — it's plausibility.** The asset ships
every tip's `lineage`, so a modified client can compute the distance itself; the correct
side *cannot* be hidden. Design so that buys nothing ranked: **the server grades, and
only humanly-plausible play ranks.** Extend the existing anti-cheat spine
(`apps/scores/sessions.py` signed tokens, `apps/scores/scoring.py` re-score, the
"humanly-plausible pace" gate on `Run`) — don't invent a new one.

The load-bearing requirements (full audit in #36):

- **Result integrity.** The server is the sole grader: winner = recorded lock-ins ×
  *server-side* distance, anchored to a signed session (reuse the `runs/start` token).
  Never trust a client-reported winner or score.
- **Reaction-time plausibility** is the real anti-cheat: a correct pick faster than human
  reaction (~200–300 ms floor) is the tell. Extend the pace gate to per-round lock-in
  latency. Same class as #114.
- **Bot & solo stay unranked** — a strong bot must not let solo-vs-bot wins feed the human
  ladder. Tag bot/solo matches server-side; keep them off the competitive board.
- **WebSocket surface (Phase 1):** validate the `Origin` header (Channels
  `AllowedHostsOriginValidator`) to stop cross-site socket hijacking; authenticate at
  connect; verify the sender participates in *that* match on **every** frame (per-message
  authz / IDOR) with **random, unguessable match ids**; validate every frame and rate-limit
  messages / cap payload size + sockets per user. (No DRF throttling exists today — add it
  for the matchmaking REST too.)
- **Redis:** TTL on every match key (abandoned matches must not grow Redis unbounded);
  namespace keys (shared with Celery); the pre-reveal answer never rides a channel a client
  receives.
- **ASGI:** no per-request state in module/global scope — a reference leaked across `await`
  can serve one user's data to another; scope consumers strictly to their connection.
- **Data minimization:** reveal payloads carry only what's needed — never the opponent's
  pick before reveal, the correct side before reveal, or PII beyond the public display name.

When code exists, run `/security-review` on the diff — this section is its design-time
counterpart.

## What it reuses

- **Scopes / asset loading / scope picker / mix pipeline** — from Time Attack, unchanged.
- **Lobby + `GameConfig`** — Marathon's config panel plus invites
  ([`lobby-and-config.md`](lobby-and-config.md)).
- **Signed sessions + server re-score + pace gate** — the anti-cheat spine in
  `apps/scores/` (`sessions.py`, `scoring.py`).
- **Mode/leaderboard model** — a game is `(mode × difficulty)`; a new mode is data, not a
  special case ([`games-model.md`](games-model.md)).

## Build order

Deliberately phased so nothing waits on the hardest part; detail + open decisions in **#36**.

1. **Distance core + solo + bot** *(done, Phase 0)* — the shared `relatedness()` primitive,
   the pluggable `DistanceEngine`, the rank-gap round generator, and single-player Clade
   Clash (+ bot) with the health-duel loop on Time Attack's scopes. Client-side and
   **unranked** — nothing is submitted, so a modified client only fools itself. Proves the
   metric is fun and fair, and unblocks #126/#127. The **bot's difficulty is owned by the
   engine** (`DistanceEngine.bot(gap)` → accuracy + delay), so it's strong ("extremely
   efficient") and a new engine sets its own; the same bot powers **versus-vs-a-bot as a
   client-side duel** (unranked, no server round-trip — reachable straight from the versus page).
2. **Realtime Clade Clash** *(done, Phase 1)* — one ASGI stack + Channels + Redis channel
   layer + the match lifecycle (`apps/clash/`). Human vs human, **ranked**, with quick-match +
   private-room invites, server-authoritative round generation + grading, reaction-time
   plausibility, and the **cross-process Redis match lock** (correct across pods, see
   Realtime → Concurrency). Delivers the #103 substrate.
3. **Depth & scale** — genetic/patristic distance via the weavers; spectate; and, *if* a
   competitive ladder is ever wanted, an **ELO / rating ladder** off the `MatchResult` rows
   (a duel wants a *rating*, not a score leaderboard — the raw results are already recorded
   with `ranked`/`flagged` for exactly this). Not planned yet; nothing depends on it.
