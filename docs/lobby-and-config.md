# Game lobby & GameConfig

How a game is *set up* and *started* — the layer between the hub and the play surface. The
hub becomes a clean game picker; each game gets a **lobby** (setup page) where you choose its
pack(s), difficulty, and settings, then start. The lobby is designed as the single-player
case of a future multiplayer room, and the config it produces is the seed format for
shareable challenges and real-time matches. Design locked 2026-06-25.

## Vocabulary (three distinct things)

| Term | What it is | Status | Effect on score |
|---|---|---|---|
| **Settings** | Per-game tuning + visual dials (start time, time-per-organism, combo window, layout, falling leaves) | exists (`GameSettings`) | via the multiplier model (below) |
| **Modifiers** | Gameplay *mutators* that change how a game plays — blind mode, no-tree, … | **future** | a score **multiplier** (>1 harder, <1 easier) |
| **Packs** | The playable asset(s) / scope(s) — which clades | exists (scopes) | none (it's the pool) |

Settings and modifiers are kept separate (player tuning vs challenge mutators — different UI,
different intent) even though both ultimately feed one number: the run's score multiplier.

## Everything resolves to a multiplier

There is **one board per `(mode, scope, difficulty)`** and **every run is on it**, ranked by
`final = base_score × multiplier`. The default config is exactly **1.0×**. Each setting and
modifier *declares its own multiplier contribution*; the run's multiplier is the product.

- Visual settings → always 1.0× (neutral).
- A harder modifier → e.g. 1.15×; an easier one → 0.90×.
- A setting that eases the game (e.g. infinite time) → <1.0× (it no longer hard-bans ranking;
  it just scores less).

This **replaces the old binary `ranked` taint**. `ranked` now means only "passed anti-cheat"
(valid signed session + plausible placement rate) — decoupled from whether the config was
default. A harder run *can* outrank a default run; that is the point of modifiers.

**Server is the authority.** The server re-derives the multiplier from the submitted config
against its own admin-tunable modifier/settings definitions — never trusting a client number,
exactly as it already re-derives combo/clade bonuses from the signed session. The resolved
`GameConfig` and the computed `score_multiplier` are stored on the `Run` for audit/replay.

**Built (#101).** `final = base × ∏(modifier multipliers) × ∏(setting derates)`:
- **Modifiers** are admin rows (`GameModifier`: key, label, multiplier, `incompatible_with`),
  served by `GET /api/scores/modifiers/?mode=`. A harder one is >1.0×, an easier one <1.0×.
  *A modifier is only added once its in-game effect exists* — otherwise it multiplies a score
  without changing the game. First shipped: **`no_tree`** (1.3×) — hide the cladogram and play
  off a plain scrollable list of what you've named (`components/PlacedList.tsx`); a real memory
  challenge with the loop otherwise unchanged.
- **Setting derates** turn each score-easing setting into a ≤1.0× factor (infinite time, a
  longer clock) instead of hard-banning the run. Per-setting rules live in
  `apps/scores/multipliers.py` (admin-overridable via `GameDefaults.setting_multipliers`).
- `ranked` no longer means "default settings" — it means **anti-cheat-eligible** only (valid
  signed session + plausible placement rate). Every other run is on the board at its multiplier.
- The server resolver (`multipliers.py`) is mirrored on the client (`lib/game/multipliers.ts`)
  for the lobby's live multiplier preview; the server re-resolves authoritatively at submit.
- `Run` stores `base_score`, `score_multiplier`, and the resolved `config`.

## Per game, always

A **game owns its config**: its settings schema, its defaults, and (later) its modifier set.
Adding a game is adding an *entry* — never reshaping another game's. Concretely:

- Frontend: a per-`mode` **settings schema + defaults registry** (Time Attack is one entry).
- Backend: `GameDefaults` is keyed per `mode` (one row per game; one row today).

There is no global/shared default to "split later" — it is per-game from the first commit.

## GameConfig — the single source of truth

```ts
interface GameConfig {
  mode: string;            // "marathon_free" — the game
  difficulty: Difficulty;  // "common" | "scientific" — the lens
  scopes: string[];        // the chosen packs (sorted; a mix is first-class)
  settings: GameSettings;  // per-game tuning + visual dials (exists today)
  modifiers: string[];     // active gameplay mutators (future; empty for now)
}
```

This replaces today's scattered `?scopes=&difficulty=` URL params + ad-hoc localStorage. The
lobby *builds* a `GameConfig`; starting threads it to the play surface. It is also exactly
what a multiplayer host will broadcast to a room — single-player is a room of one.

**Encodable.** `GameConfig` serializes to a compact, URL-safe code from day one (settings as
a short keyed delta-from-default, not the whole object). We don't build share UI yet, but the
format is fixed now because it is the seed for: shareable setups, "beat my run" challenges,
and real-time lobby invites. Keep it stable and versioned.

## Surfaces

- **Hub** (`/`) — uncluttered: the Daily card + **one card per game** (best score / progress)
  + nav. No difficulty toggle, no pack picker, no settings here anymore. A card → the lobby.
- **Lobby** (`/play/:mode`) — the setup page: pick pack(s), difficulty, and settings; see the
  resulting multiplier; **Start**. Generic: it renders any game's settings schema. The
  single-player shape is `{ config, players: [you], status }` — the multiplayer room is the
  same component with a synced config + participant list + ready/start.
- **Play** (`/marathon`, …) — receives a frozen `GameConfig`. **Gameplay settings/modifiers
  are locked once a run starts** (a mid-run change would corrupt the multiplier). The in-game
  gear keeps only **visual** prefs (layout, leaves, scientific-name display) + dev cheats.
  Reached only via the lobby (`?c=`) or as the daily; a bare `/marathon` redirects to the
  lobby (no legacy `?scopes=`/`?difficulty=`/`?remote=` params).
- **Post-game = view-only exploration.** When a run ends the score locks and the game is over;
  the finished tree stays pan/zoomable with the missed species revealed as ghosts — an
  educational reveal, *not* a "keep placing" mode. (There is no infinite-time revive.)
- **Daily** — bypasses the lobby entirely: its config is server-fixed and locked (Common), so
  the Daily card links straight to play.

## Phasing

**Now (frontend + a small backend structuring):**
1. Per-`mode` settings schema + defaults registry; extract reusable setting-control primitives
   from `SettingsPanel`.
2. `GameConfig` type + the encodable format (versioned).
3. `GameDefaults` keyed per `mode` (small migration; one row today) + `/game-defaults/?mode=`.
4. Lobby page `/play/:mode` — packs + difficulty + settings + Start.
5. Unclutter the hub to one card per game; route hub → lobby → play.
6. Thread `GameConfig` into Marathon; gear → visual-only & frozen-at-start; Daily bypasses.

**Done (the modifier feature — backend authority, #101):**
7. ✅ Admin-tunable, per-game **modifier model** (id, label, multiplier, incompatibilities);
   `/api/scores/modifiers/?mode=`. Server resolves `score_multiplier` from the config; board
   ranks by `base × multiplier`; stores `config` + `base_score` + `score_multiplier` on `Run`;
   `ranked` retired to anti-cheat-only. Score-easing settings derate via `setting_multipliers`.
   (Specific modifiers ship later, each with its in-game effect.)

**Much later (multiplayer — do not build any backend now):**
8. ~~Shareable config codes + async "beat my run" challenges~~ — won't build (closed, #102).
9. Real-time lobby/match: server room model + realtime transport; the lobby component becomes
   shared (synced config, ready-up, start signal, live scores). Designed-for, not built (#103).

## Name collisions across mixed packs — *smaller pack wins*

Packs mix freely (blob pools merge; hybrid/remote packs add their tail — see
`lib/asset/load.ts#loadMixed`). A typed name can therefore mean different animals in different
packs. This is **rare**: measured against the live blob packs (amphibia, aves, fish, mammalia,
reptilia — 372,916 distinct names) only **39** vernacular names truly collide (~0.02%, ≈1 in
5,000) — all fish-vs-something homonyms like `wolf`, `robin`, `monkey`, `panda`, `hammerhead`,
`hedgehog`, `spoonbill`, `echidna`. Scientific names never collide (binomials/genera are unique).

**The rule: when a name resolves to candidates from more than one pack, the SMALLEST pack
(fewest tips) wins.** The smaller pack is the more specialised, intentional choice, so in a
`fish` (37k) + `mammalia` (6k) mix, `wolf` → the mammal, not the pike. Ties in size fall through
to the existing tie-break (primary-name match → most-specific → fame → id). The rule is applied
*before* those, so it is the dominant cross-pack discriminator.

Implemented identically in both delivery paths so behaviour never depends on how a pack ships:
- **Local (merged blobs / notable subsets)** — `lib/asset/load.ts` builds `InternedAsset.packSize`
  (target id → smallest containing pack's tip count); `lib/game/resolve.ts` step 0 keeps only the
  smallest-pack candidates, then settles within that pack.
- **Tail (hybrid/remote `/resolve`)** — `lib/game/resolveTarget.ts` sorts the tail components by
  size ascending and takes the first hit, so the smaller pack is consulted first.

Single-pack play has no overlap, so `packSize` is unset and the rule is a no-op there.

*Known bound:* if a small pack's meaning lives only in its streamed **tail** (not its notable
blob) while a big pack ships the name in its blob, the big-pack blob hit is returned before any
tail is consulted. This is a sub-sliver of the already-0.02% case and is accepted rather than
defeating the "resolve locally first" performance design.

## Why it scales

A new game is data + a schema: a `GameModeConfig` row, a settings schema entry, its
`GameDefaults` row, and (optionally) its modifier set. It drops into the hub (a card), the
lobby (rendered generically), scoring (its own multiplier resolution), and the leaderboards
with no new structures — the same "adding a game is data" property the games model already has.
