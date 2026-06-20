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
  on the tree…"), and a live count.
- **Naming — species *or* clades** (animalist-style). Autocomplete offers any real
  taxon in scope: a species (e.g. "lion") or a clade (e.g. "Felidae" / "cats").
  Typos resolve to nothing and cost nothing. A name routes onto the shared induced
  tree through its lineage.
- **Reward tiers (the specificity rule).** Three cases (cf. animalist, which we
  mostly follow):
  - **New lineage** — a node with no already-placed ancestor or descendant →
    **full reward** (time + score).
  - **Refinement** — a species *below a clade you already named* (e.g. you have
    "Felidae", then say "lion") → the clade is struck through ("Replaced by more
    specific *Lion*") and you get a **small reward** (animalist gives zero here; we
    give a little to keep the dopamine of getting specific).
  - **No reward** — a duplicate, or a *parent of what you already have* (climbing
    up to a node already implied). "cat" after "Felidae" → nothing (same node);
    naming "Mammalia" when you already have a mouse → nothing.
  Net effect: breadth (new branches) pays most, getting specific still pays a bit,
  and generalizing upward or repeating pays nothing — which promotes specificity.
- **Timer.** Start ~60s. Each rewarded placement **adds time** (amount weighted by
  novelty + obscurity — see below). Run out → game over.
- **Pool = all species in scope** (not a curated top-N): every non-extinct species in
  the dataset is nameable and counted, so the tree can be filled to completion and
  the "N remaining" hints mean something all the way down. See
  [`data-pipeline.md`](data-pipeline.md#stage-3--pool-selection-what-s-playable-and-counted).
- **Score.** New nodes placed (a player chasing score is pushed toward specific
  species, since shallow ancestors are quickly "already there"). Leaderboard-bearing,
  so scoring is re-validated server-side at submit (see [`architecture.md`](architecture.md)).

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

### Time-bonus weighting

A rewarded placement (a new node) adds time. How much is weighted by two factors:

- **Novelty** — how much new backbone the name opens, i.e. the rank-depth of the
  MRCA between the new node and the existing tree. First echinoderm when you've only
  named mammals → near the root → big bonus; your fifth finch → shallow MRCA → small.
- **Obscurity** — `tip.time_weight`, derived from **Wikipedia pageviews** (the
  `wikipedia_weaver` fame signal): an obscure species is worth *more* time than an
  instantly-obvious one. Fame no longer gates *inclusion* (the pool is all species);
  it only tunes reward/difficulty here. See
  [`data-pipeline.md`](data-pipeline.md#stage-4--braidworks-enrichment-common-names--fame).

Naming an ancestor you already have adds **no** time at all (it places no new node).
Together with the hidden labels (which reward going *deep* to complete a clade), this
gives Marathon its rhythm: open new branches and dive into specifics; don't bother
generalizing upward or spamming names you've already covered.

### Optional: the "trait?" reveal

Spend time/points to surface a vague, **nameless** clue about one hidden sister
under a clade — drawn from `tip.traits` (environment / biome / extinct). E.g.
"the hidden one here is marine." Helps when you know a clade has `2 hidden` but
can't recall them, without handing over the answer.

## Name resolution

Players must be able to type natural names — "panda bear" → *Giant panda*, "river
otter" → *North American river otter*, "panther" → *Panthera*, "the lion" → *Lion* —
or the game is awkward. The approach (validated against rose.systems/animalist's
source) is **comprehensiveness, not fuzzy matching**: a big precomputed
`normalized name → id` map, then an **exact lookup** at play time. No edit-distance
engine; the dictionary is just rich enough.

What feeds the alias index (this is how the reference gets its coverage — verified
against its `species.py`):

- **enwiki sitelink title** — the *primary* source. The English Wikipedia article
  for a clade is usually titled with the common name: Hyaenidae → "Hyena",
  Pholidota → "Pangolin", Tachyglossidae → "Echidna", Ursidae → "Bear".
- **Wikidata aliases** (`skos:altLabel`) + **label** — "the lion", "panda bear",
  "kangaroos", spelling variants, synonyms.
- **CoL / Wikidata vernacular names** (`VernacularName.tsv`, `P1843`).
- **Scientific names** and **clade names** (genus/family/… — clades are nameable).
- *(Optional, not yet: Wikipedia `prop=redirects` for the long tail — the reference
  ships with this disabled, so we don't need it for parity.)*

Crucially these are harvested for **clade nodes too**, not just species — that's how
"bear"/"whale"/"sloth" resolve.

All flattened through the same `normalize()` (lowercase, hyphens + underscores →
spaces, punctuation folded, whitespace collapsed) and baked into the asset's
`aliases` map. **Crucially, names are harvested for clade nodes too, not just
species** — that's how "bear" → *Ursidae*, "whale" → a cetacean clade, "sloth" →
*Folivora* resolve (the reference does the same by harvesting every taxon). No
dropdowns / autocomplete UI — the player just types and it resolves.

The frontend **resolve(query)** is deliberately tiny (no fuzzy engine, no dropdowns):

1. `normalize(query)` → **one** lookup in `aliases`. Plurals are handled at *build*
   time, not here: every alias is indexed under both its singular and plural form
   (`index_keys`), so "bears" and "bear" both hit without the query trying variants.
   Lookup stays O(1) per guess.
2. multiple candidates → drop any that is an *ancestor* of another candidate
   (so "hippopotamus" → the species, not the genus); if still >1 (genuine
   ambiguity like "elk" = wapiti/moose), pick the **highest-fame** one.

A miss just doesn't resolve (no wrong guess spent). Known edge: cross-kingdom
scientific-name homonyms (e.g. *Pholidota* = pangolins *and* an orchid genus) can
resolve to the wrong kingdom; scope the Wikidata lookup to Animalia to fix. See
[`data-pipeline.md`](data-pipeline.md#stage-4--braidworks-enrichment-common-names--fame)
for harvesting and [`game-asset-format.md`](game-asset-format.md#aliases--autocomplete--matching-index)
for the index shape.

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
- **Pool = all species in scope; scope is a well-covered clade (or a per-clade
  game).** Every non-extinct species in the loaded dataset is nameable + counted,
  plus its clades. "Scope" is chosen for good common-name coverage — e.g. Mammalia
  (97.7% CoL common names), birds, herps, fish — and each can also be its own themed
  game ("Mammals marathon"). The long tail of all-Animalia (insects, worms) is *not*
  loaded by default because common-name coverage collapses there; a scientific-only
  mode can open it later.
- **Names are matched space-insensitively / underscore-free.** Players type natural
  names ("brown bear", "Felidae") — never underscores. The alias index is normalized
  (lowercase, punctuation/underscore folded to spaces) at build time, so any
  underscore-bearing source (e.g. a Wikipedia title `Brown_bear`) still matches a
  space-typed query. No player-facing display name carries underscores.
- **Naming outside the loaded scope just doesn't resolve** — autocomplete only offers
  taxa in the current dataset, so it can't be typed and costs nothing.
- **Extinct taxa are excluded from v1**, with the `extinct` flag preserved for a later
  themed **paleo** marathon — a separate scope, not built now.

## Still to settle by playtest

- Exact starting time, per-tip base bonus, and the novelty multiplier curve.
- `HIDDEN_LABEL_MAX` default (currently 15) and which hidden-label style (① "?" +
  count vs ② silhouette) wins the A/B.
