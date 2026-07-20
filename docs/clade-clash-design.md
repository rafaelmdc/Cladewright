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
pipeline emit branch lengths or a per-scope distance matrix into the asset. The game loop
and the `distance()` signature don't change; only what fills them in does.

**This needs a NEW data source — the existing weavers cannot supply it.** An earlier draft
of this doc claimed Braidworks' `gtdb_weaver` made patristic distance "a pipeline
extension". It does implement real patristic distance (`tree.py`: Newick → per-leaf root
paths → summed branch length), but on the GTDB **bac120 / ar53** reference trees, which
cover **bacteria and archaea only**. Every scope this game serves is metazoan (mammals,
birds, reptiles, amphibians, fish, molluscs, nematodes, flatworms, cnidarians, …), so GTDB
coverage is **zero**. `ncbi_weaver` returns ranked *lineages* — topology again, no branch
lengths — and `uniprot_weaver` returns protein accessions, which would mean building an
alignment pipeline.

Real candidates are dated animal phylogenies (chronograms). Coverage is **partial, and that
is a design constraint**: dated trees for molluscs — our largest scope — nematodes and
flatworms barely exist. So a patristic engine is per-scope opt-in with `rankDepthEngine` as
the fallback, never a global swap. The `DistanceEngine` seam already expresses this.

#### The cheap reduction: one number per node

A chronogram is **ultrametric** — every extant tip sits at time zero. So the patristic
distance between two living tips collapses to `2 × age(MRCA)`, and `relatedness()` already
returns `mrcaIdx`. The whole engine is therefore:

```ts
closeness: (r) => -nodeAge[r.mrcaIdx]
```

**One float per node**, not a pairwise matrix (10k birds would be 50M pairs — unshippable).
`InternedAsset` already carries per-node-index arrays, so `nodeAge` slots straight in.
Rounds also get *better*: rank-depth ties constantly because many nodes share a rank, while
ages are continuous, so distinct MRCAs give distinct closeness. `minGap` and `damage` become
millions of years — self-explanatory units — and the reveal reads "these split 8 Myr ago"
instead of "shared family".

#### The blocker is topology, not branch lengths

Our tree is Catalogue of Life: a **taxonomy**, not a phylogeny. Chronograms are inferred
phylogenies with genuinely different topology, and many Linnaean groups are paraphyletic.
Ages cannot be bolted onto CoL nodes — the nodes do not correspond. **A dated pack is built
from the chronogram itself**, and lives alongside the CoL packs. Different distance,
different pack.

#### Sources, and the licence gate

| Source | Coverage | Licence |
|---|---|---|
| **TimeTree 5** | 137,306 spp, all life | ✗ *"Redistribution of TimeTree data and its transformations are not permitted"* — a served asset **is** redistribution |
| **DateLife / OpenTreeChronograms** | 253 chronograms, 187 studies, 99,474 spp (Mar 2024); stores patristic distances **in Myr** | GPL — redistributable |
| **Fish Tree of Life** (Rabosky) | 11,638 genetic / 31,516 all-taxon | R package is BSD-2; **data licence unconfirmed** |
| **VertLife / BirdTree** | birds ~10k, mammals ~5.9k, squamates 9,755, amphibians 7,238, sharks 1,192 | **unconfirmed** — the Jetz Lab statement talks about open science without naming a licence |

**Confirming the VertLife and fishtree *data* licences is a hard gate on all of this.** It is
an email, not an investigation, but nothing ships before it is answered.

#### Measured coverage (2026-07-20)

Share of tips in a clade that has a published dated megatree, by fame rank:

| Fame band | Species | Covered | % |
|---|---|---|---|
| top 100 | 100 | 73 | 73.0% |
| top 1,000 | 900 | 557 | 61.9% |
| top 5,000 | 4,000 | 1,826 | 45.7% |
| top 20,000 | 15,000 | 10,906 | 72.7% |
| the rest | 355,534 | 62,715 | 17.6% |

~74,700 of ~375,500 tips (20%) sit in covered classes. But **"in a covered clade" is not "in
the tree"** — the published trees are smaller than our pools (Aves ~100%, Mammalia ~92%,
Amphibia ~81%, Reptilia ~78%, but **Teleostei only ~33%**: 11,638 inferred against our
35,777). Realistic matched coverage is **45–55k tips**.

The dip at top-5k is charismatic invertebrates, and the loss is real — roughly a quarter of
our top 100. The most famous uncovered species are the immortal jellyfish (fame 562,324),
pinworm, Humboldt squid, *C. elegans*, crown-of-thorns starfish and the box jellyfish. This
is the strongest argument for Deep Time as a **pack family alongside** the CoL packs rather
than a replacement: the immortal jellyfish keeps its home, it just never gets a Myr distance.

Record per-tip provenance (inferred vs grafted) in the asset. It is free at build time and
unrecoverable later, so it exists to diagnose "these rounds feel wrong" if that ever happens.
It deliberately gates **nothing** — no ranked policy, no round-generator special case.

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
3. **Depth & scale** — patristic distance in two tracks (below), and *if* a competitive ladder
   is ever wanted, an **ELO / rating ladder** off the `MatchResult` rows (a duel wants a
   *rating*, not a score leaderboard — results already carry `ranked`/`flagged` for exactly
   this). Nothing depends on any of it.

   **Track A — harvest what exists** *(weeks)*. Ingest all six published chronograms (fish,
   birds, squamates, amphibians, mammals, sharks; ~46–67k tips), reconcile names against our
   CoL tips, build packs from the trees with node ages in Myr, and ship the engine above. Then
   **play it** — the whole point is finding out whether Myr rounds are actually more fun than
   rank-gap ones. Validate on **birds first**: ~100% match rate, so a bad result indicts the
   *metric* rather than the data. Ingest every tree including fish — filtering at grading time
   is always recoverable, filtering at ingest is not.

   **Track B — build what doesn't exist** *(months; a genuine research project)*. ~300k tips
   have no published dated tree: gastropods (109,620), flatworms, polychaetes, bivalves,
   sponges, bryozoans, corals, nematodes.

   - **B0. Coverage dry run — the gate.** `phylotaR` / `SuperCRUNCH` against GenBank for one
     target clade, asking only *how many species have ≥2 usable markers*. An afternoon, no
     compute. 15k sequenced gastropods means a real tree; 2k means stop here.
   - **B1.** Mine GenBank via `pyPHLAWD` / `phylotaR` — clusters homologous sequences and
     assembles the supermatrix without an a-priori sequence list.
   - **B2.** Multi-locus: `COI` + `16S` (species-level) with `18S` / `28S` (slow-evolving,
     informative at depth) and `H3`. COI *alone* saturates above family — that is why
     COI-only is a dead end and a multi-marker matrix is not.
   - **B3.** MAFFT align, concatenate with partitions.
   - **B4.** Constrain the backbone above family level to a published deep phylogeny or the
     Open Tree synthesis. Never let a supermatrix invent deep relationships.
   - **B5.** IQ-TREE / RAxML inference — the genuinely compute-bound step.
   - **B6.** `treePL` dating, calibrated with Paleobiology Database fossils. This is what
     turns substitutions into millions of years, and where the real methodological judgement
     sits.
   - **B7.** Graft the unsequenced by taxonomy, recorded as grafted.

   Output feeds Track A's steps 2–4 unchanged — the builder and engine don't care where a
   chronogram came from. **Order matters:** A first (cheap, and tells you if the metric is
   even worth having), B0 as the probe, B1–B7 only when both say go.

   **On publishing Track B.** The contribution is *not* "a dated gastropod phylogeny" (a
   one-off someone else will produce anyway) and *not* "a database of every distance" — that
   is TimeTree, DateLife and Open Tree already. The defensible claim is a **modern, open,
   containerised, continuously-running pipeline**. Know the prior art before writing:
   **SUPERSMART** (Antonelli et al., Syst Biol 2016) is literally a "Self-Updating Platform"
   for dated phylogenies, and there is a continuously-updated fern tree of life (2022). The
   `supersmartR` repo — "*towards* a modular SUPERSMART pipeline" — suggests the 2016 platform
   bit-rotted, which is the opening: this would be an **implementation** contribution
   (reproducible, maintained, actually running), not a conceptual one. Claim the concept and
   a reviewer hands you Antonelli 2016.

   **Spectate is rejected, not deferred.** A read-only third connection would have been cheap
   (every frame already broadcasts to a per-match group, and `public_round()` is already the
   answer-free projection a watcher needs) — but it is not worth having. It also carries a
   collusion vector: a spectator can *derive* the answer exactly as a player can, then relay
   it out-of-band, which neither the reaction-time floor nor `FAST_PICK_LIMIT` detects.
   Don't reintroduce it without a reason better than "it was easy".
