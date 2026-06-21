# Games model

How Cladewright structures games, scoring, stats, and the daily — the shared mental model
behind the hub, the leaderboards, and the profile. Locked 2026-06-21.

## A "game" = base × difficulty

A playable thing is identified by three axes:

| axis | values | role |
|---|---|---|
| **base** | `marathon` (later: `guess`, …) | the game itself |
| **difficulty** | `common` · `scientific` | the *lens* — vernacular names vs Latin only |
| **cadence** | `free` · `daily` | endless anytime vs one shared seed/day |

The **scoring unit is `(mode, difficulty)`**. "Marathon · Common" and "Marathon · Scientific"
are separate games — separate leaderboards (already), separate stats, separate score cards.
`scope` (mammals/birds/fish) is a *filter within* a game, not a separate game (keeps the card
grid from exploding). Internally `mode` already encodes base+cadence (`marathon_free`,
`marathon_daily`); `difficulty` is its own column on `Run`/`PlayerStat`/`NamedSpecies`.

## Free play → cards

Each enabled, difficulty-supporting game shows **two hub cards** (Common, Scientific). No
difficulty toggle — the lens *is* the card. Cards show **best score + progress** (and, once
dailies ship, the single 🔥). Drop the old conflated "free play" card.

## Daily → one site-wide puzzle

**One daily for the whole site**, not one per game — too many dailies fragments the player
pool and discourages trying other games. The single daily:

- is **one shared puzzle per day** (same seed for everyone),
- **rotates which game it features** once more than one exists → the daily becomes the
  *discovery engine* that exposes players to other games,
- has **one board** (headline Common; Scientific is an optional hard-lens flex on the same
  puzzle),
- drives **one streak**.

The hub gets a small, clean **"Today" daily card** (present, never noisy) above the free-play
cards.

**Admin-tunable, one-shot.** The daily is resolved server-side by `_daily_plan(date)`:
a manual **`DailyPin`** for that date wins; else the active **`DailyRotationEntry`** pool
cycles by date (both *game* and *clade* rotation are admin-managed); else it falls back to
rotating the served scopes. The daily **locks after one play** per day (no grinding a better
number) — `GET /api/scores/daily/` then reports `played_today` + `today_score`, and the card
shows the result instead of Play. **Per-game dailies are expressible** (pins/rotation/runs
all carry `mode`, pins are unique per `(date, mode)`); the frontend surfaces one headline
daily for now.

## Streak → one flame

**One GLOBAL day streak per player** — advanced by playing *any* game's daily that day, so
it survives game rotation. Earned only by doing the daily; free-play replays never build it
(a grindable streak is worthless). Stored on a single `Streak` row under the sentinel key
`"daily"` (`DAILY_STREAK_KEY`), surfaced on the daily card and the profile.

## Profile

- **Single daily 🔥** in the header.
- **Score cards** — one per `(mode, difficulty)`: best score, animals named, … (scores are
  *not* comparable across games, so they live in cards, not the heatmap).
- **One activity heatmap**, GitHub-style, with **game toggle chips** on top. Shading is
  **adaptive to the filter**:
  - **All games** → shade by **plays/day** (activity aggregates across games).
  - **One game** → shade by **that game's best score/day** (now comparable); click/drag to
    compare days shows *scores*.

  One heatmap, filterable — never N heatmaps. A new game = a new chip + a new score card,
  never a new heatmap.

## Why this scales

Adding a game (`guess`, …) is data: a `GameModeConfig` row + its `(mode, difficulty)` boards.
It slots into the hub (cards), the profile (chip + score card), the daily rotation, and the
leaderboards with **no new structures**.
