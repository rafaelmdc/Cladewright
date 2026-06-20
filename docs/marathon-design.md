# Marathon — game design

Marathon is the primary, novel game. This doc is the design of record for its
mechanics and the rules that keep its signature feature — the "N remaining"
labels — readable instead of cluttered. Wireframes: `docs/examples/marathon.png`
and `docs/examples/marathon hints example*.png`.

## The loop

> Name as many organisms as you can before the clock runs out. Each valid one
> lands on a tree you grow live; clades you nearly complete reveal how many
> species are still hidden under them.

- **The tree canvas is the whole UI.** No side panels. A floating top HUD over the
  canvas holds: countdown timer, a single text input ("name an organism — it lands
  on the tree…"), and a live count of tips placed.
- **Naming.** Type an organism; autocomplete restricts to real pool taxa (typos
  resolve to nothing and cost nothing). A valid, not-yet-named organism sprouts as
  a tip on the shared induced tree, routed in through its lineage.
- **Timer.** Start ~60s. Each valid new organism **adds time**; more for organisms
  that open new ground (see novelty bonus). Run out → game over.
- **Score.** Tips placed. Leaderboard-bearing, so scoring is re-validated
  server-side at submit (see [`architecture.md`](architecture.md)).

## The "N remaining" mechanic

This is the heart of Marathon and the thing the whole design protects.

Every internal node knows `pool_count` — how many *playable-pool* species sit
beneath it (precomputed; see [`game-asset-format.md`](game-asset-format.md)). As
you name tips, the client increments `found_count` along each tip's lineage. A
branch shows a **hidden label** — e.g. `2 hidden` — when:

```
remaining = pool_count - found_count
show label  ⇔  remaining <= HIDDEN_LABEL_MAX  AND  found_count >= 1
```

So: list a few bears and the *Ursidae* branch starts whispering `2 hidden` — a
carrot to go find them. The label is **count only, never a name**. (It is a mild,
intentional spoiler: it admits the hidden ones *exist*. That's the hint. The
threshold is therefore a difficulty knob as much as an anti-clutter knob.)

### Why this doesn't clutter

Three rules, layered, keep labels to the live frontier:

1. **Induced tree only.** The canvas draws just the minimal subtree connecting
   named tips through their MRCAs — never the full backbone. The 400-tip flood
   never happens.
2. **Threshold gating.** Near the root, `remaining` is huge → nothing shows. A
   label can only appear once a clade is *nearly complete* (`<= HIDDEN_LABEL_MAX`)
   **and** already entered (`found_count >= 1`). Labels live only where you're
   close to finishing something.
3. **Deepest-branch placement + roll-up.** Show the count on the **deepest single
   branch** that captures the remaining set; if several nested clades qualify, the
   parent rolls them up into one label. Zoom or hover to expand into the sub-clade
   breakdown. No stacking five labels on one fork.

`HIDDEN_LABEL_MAX` is tunable (default 15, per asset `thresholds`). Two label
styles are worth A/B testing (both already sketched): ① dashed node + "?" + count,
② grey silhouette blob + count.

### Cost

This is cheap by construction, not by luck. `found_count` is kept incrementally:
naming a tip increments only the ≤~25 nodes on its lineage path (`O(L)`), and
because `remaining` only ever decreases, each branch crosses the reveal threshold
**at most once** — so label bookkeeping touches only that one path, never all
nodes. The full pool and backbone are never iterated during play. Full design and
complexity table: [`performance.md`](performance.md).

### Novelty time bonus

"Rarer clade = more time" needs a concrete definition. Use **novelty**, not raw
rarity: the bonus scales with **how much new backbone the tip opens** — i.e. the
rank-depth of the MRCA between the new tip and the existing tree.

- First echinoderm when you've only named mammals → MRCA is near the root → big
  bonus (you cracked open a new branch).
- Your fifth finch → MRCA is a shallow genus/family node → small bonus.

This rewards breadth and exploration over spamming one dense clade, and pairs
naturally with the hidden labels (which reward the opposite — going *deep* to
complete a clade). The two mechanics together give Marathon its rhythm: sweep wide
for time, then dive to mop up `N hidden` for score.

### Optional: the "trait?" reveal

Spend time/points to surface a vague, **nameless** clue about one hidden sister
under a clade — drawn from `tip.traits` (environment / biome / extinct). E.g.
"the hidden one here is marine." Helps when you know a clade has `2 hidden` but
can't recall them, without handing over the answer.

## Layout stability

The single biggest UX risk. A radial layout reflows **globally** when a node is
added; if branches teleport, the game feels broken. Non-negotiable mitigations,
designed in from the first TreeRenderer commit:

- **Animate every position change** (Framer Motion / d3 transitions). Nodes glide
  to new positions; they never jump.
- **Anchor the focus.** Keep the player's current/just-grown clade stable on
  screen and let distant branches absorb the reflow, so they don't lose their place
  mid-type.
- **Densify with zoom.** As a clade fills, let the player zoom in; the layout gains
  room locally instead of cramming. "Fit" button to recenter.

## Mobile

Radial tree + pan/zoom + a persistent text input is tight on a phone. Treat mobile
as a primary target, not an afterthought: HUD input pinned above the keyboard,
generous touch targets on nodes, pinch-zoom, and labels that stay legible at small
scale (lean on the silhouette style ② if "?" + count gets cramped).

## Decisions

- **Two modes ship in v1: daily-seeded + free play.** The daily-seeded run starts
  everyone from the same nudge so scores are comparable (server-authoritative seed,
  like Classic — see [`architecture.md`](architecture.md)); free play is an
  unlimited fresh run any time. The leaderboard is per-day for daily, all-time best
  for free play.
- **Off-pool names can't happen — autocomplete is pool-only.** The input only offers
  pool taxa, so a real-but-unincluded animal never resolves and never costs the
  player anything. No backbone-wide name matching needed. (If this feels too
  restrictive in playtest, the ghost-tip option is the fallback.)
- **Extinct taxa are excluded from v1**, but the design keeps the door open for a
  later **themed "paleo" Marathon** (dinosaurs, trilobites, …). Concretely: the
  pipeline preserves the `extinct` flag and *can* ingest fossil taxa, but v1's pool
  selection filters them out and they are neither nameable nor counted. The paleo
  mode is a later, separate pool — not built now.

## Still to settle by playtest

- Exact starting time, per-tip base bonus, and the novelty multiplier curve.
- `HIDDEN_LABEL_MAX` default (currently 15) and which hidden-label style (① "?" +
  count vs ② silhouette) wins the A/B.
