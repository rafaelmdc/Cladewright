# Performance — keeping it lightweight

Cladewright must stay light: instant input, smooth tree, tiny memory, near-zero
server work. This doc is the performance design of record, with the "N remaining"
clade counter — the feature most at risk of being heavy — worked out in full.

The governing fact: **the full backbone is millions of nodes, but no operation
ever touches it at play time.** Everything scales with two small quantities:

- `L` — a tip's lineage depth: ~7 main Linnaean ranks, ≤~25 with sub-ranks.
- the **induced display tree** — only named tips + their MRCAs; a few hundred nodes
  in a long run, usually far fewer.

Nothing in the hot path scales with the 2,500-tip pool or the backbone. A whole
Marathon (say 200 names) is on the order of *tens of thousands* of integer ops
total — trivially within frame budget.

## "N remaining" without a tree walk

`remaining(node) = pool_count(node) − found_count(node)`. `pool_count` is
precomputed into the asset. So the only runtime quantity is `found_count`, and the
trick is maintaining it and the labels **incrementally and locally**.

### 1. Interned indices + typed arrays (no strings, no GC in the hot path)

At load, the client **interns** every node id to a contiguous integer index and
builds:

- `pool_count: Int32Array` — by node index (copied from the asset).
- `found_count: Int32Array` — by node index, zero-filled.
- each tip's `lineage` as an `Int32Array` of ancestor indices (root→parent).

Strings stay in the asset for readability/debuggability; the runtime works in
integers over flat typed arrays — cache-friendly, allocation-free, no per-op object
churn.

### 2. Naming a tip = increment along one path. O(L).

```
onName(tip):
  for idx in tip.lineage:        # ≤ ~25 entries
      found_count[idx] += 1
      maybeActivateLabel(idx)    # see §3
```

No recursion, no tree traversal, no scan of other nodes. ~25 increments per name.

### 3. Threshold crossing is monotonic → each node fires at most once

`found_count` only ever increases, so `remaining` only ever decreases. A node can
therefore cross `remaining <= HIDDEN_LABEL_MAX` **exactly once** in a game. Exploit
that instead of re-scanning:

- Only the ≤`L` ancestors touched by the current name can change state — examine
  only them, not all nodes (`O(L)`, not `O(#nodes)`).
- Keep a small `activeLabels: Set<int>` of nodes currently eligible to show a count
  (`remaining <= MAX && found_count >= 1`). `maybeActivateLabel` adds a node the
  first time it qualifies; membership flips at most once per node.

So per name, label bookkeeping is `O(L)` and the set of candidate labels is tiny.

### 4. Deepest-branch roll-up, computed locally

The display rule (see [`marathon-design.md`](marathon-design.md#why-this-doesnt-clutter)):
show the count on the **deepest** eligible branch; a parent rolls up nested
eligible descendants into one label. Because only the named tip's path changed,
recompute placement **only along that path**:

- Walk the touched ancestors from deepest to shallowest. The shown label is the
  deepest `activeLabels` node on the path that is **visible** in the induced tree;
  shallower eligible ancestors are suppressed (rolled up) unless the player expands
  them by zoom/hover.
- Result: at most a handful of label re-evaluations per name, all on one path.

### 5. What stays out of the loop

- The 2,500 pool and the backbone are **never iterated** during play.
- `remaining` is recomputed only for displayed labels (a handful), on demand, as a
  single subtraction — never precomputed for every node every frame.

## Induced display tree — grown, never rebuilt

Adding a tip must not rebuild the tree. Keep a `present: bitset` (by node index) of
nodes currently in the display tree. To attach a new tip:

- Walk its `lineage` (root→parent) and find the **deepest index already in
  `present`** — that's the MRCA / attach point. `O(L)`, O(1) membership per step.
- Insert at most **one** new internal node (the new branch point) plus the tip;
  mark them `present`. Never re-derive the whole Steiner tree.

So tree growth is `O(L)` per name, and the structure handed to the layout engine
stays small.

## Rendering & layout

- **Lay out only the induced tree** with `d3-hierarchy` — a few hundred nodes;
  sub-millisecond. Re-run layout **only on topology change** (a new node), not per
  frame and not on a label flip.
- **Animate with transforms, not relayout.** Position deltas are GPU-friendly
  `transform` transitions (Framer Motion). Key React nodes by id so only changed
  nodes reconcile; memoize node components.
- **Timer off the React render path.** Drive the countdown with `requestAnimationFrame`
  / a ref and update the displayed number at most ~4×/s; don't `setState` every
  frame and re-render the tree because of the clock.
- **Cull off-screen detail.** At low zoom, skip rendering labels/sub-nodes outside
  the viewport; reveal them as the player zooms in (which is also the densify-on-zoom
  UX). Keeps SVG node count on screen bounded regardless of run length.

## Autocomplete

- The alias map is a prebuilt normalized `Map<string, tipId[]>` → exact-match
  resolve is `O(1)`.
- For prefix/typo matching, build a lightweight **prefix index** (or small trie)
  **once at load**; per keystroke do a **capped** prefix lookup (e.g. top 8),
  **debounced**. Never fuzzy-scan all common names on every keystroke.

## Asset size & loading

- Parse the asset **once**; intern to typed arrays (above) and discard the string
  forms not needed at runtime.
- Ship it **gzipped**; consider a packed columnar/binary form only if the JSON
  proves large in practice (decide on measured size, not speculatively).
- The asset is **immutable per `version`** → serve with long-lived cache headers and
  an ETag, fully CDN-cacheable. The client caches by `version` and only refetches on
  a bump.

## Server

- **Zero per-guess work.** No gameplay endpoint exists; the client plays against the
  loaded asset. The backend only serves the (cacheable) asset, handles auth, and
  persists/validates scores at end-of-run.
- Score validation at submit re-scores one run (`O(names)`), not anything per keystroke.

## Complexity summary

| Operation | Cost |
|---|---|
| Name a tip (found_count + labels) | `O(L)` (~25 int ops) |
| Attach tip to display tree | `O(L)` |
| `remaining` for a shown label | `O(1)` |
| Re-layout | only on new node, on the small induced tree |
| Autocomplete keystroke | `O(1)` exact; capped+debounced prefix |
| Per-guess server work | none |

Nothing in the play loop scales with pool size or backbone size. That is the whole
performance strategy in one line.
