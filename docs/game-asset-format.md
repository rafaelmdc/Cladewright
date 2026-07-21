# Game-data asset format

The contract between the offline pipeline ([`data-pipeline.md`](data-pipeline.md))
and the app. The pipeline produces it; the frontend consumes it; the backend
serves it by version. Treat this schema as a real interface — both sides depend on
it, so change it deliberately and bump `version`.

Format is illustrative JSON below. The on-the-wire encoding (plain JSON, gzipped,
or a packed/columnar form) is an optimization decided once the asset has a real
size; the *shape* is what's contractual.

## Design goals

- **Ship only what's reachable.** The full backbone is millions of nodes; the asset
  carries only the **pool-induced backbone** (nodes on a root→pool-tip path) plus
  counts. Everything a player can actually surface, nothing they can't.
- **Make play O(lineage length).** All MRCA / proximity / "remaining" operations
  read precomputed fields; no graph search at play time. The client interns node
  ids to integer indices and works over typed arrays — see
  [`performance.md`](performance.md). String ids stay in the asset for readability;
  the runtime is integer-only.
- **Self-describing & reproducible.** A provenance block pins exactly how it was
  built.

## Top-level shape

```jsonc
{
  "version": 7,                       // monotonic; client caches by this
  "schema": "1.0",                    // this document's version
  "scope": "kingdom=Animalia",
  "pool_size": 2500,
  "thresholds": { "hidden_label_max": 15 },  // default "N remaining" reveal cutoff
  "provenance": {
    "coldp_release": "2026-05",
    "braidworks_version": "0.x",
    "built_at": "2026-06-20T00:00:00Z"
  },
  "nodes": [ /* internal clade nodes */ ],
  "tips":  [ /* playable pool species */ ],
  "aliases": { /* search index */ }
}
```

## `nodes` — internal clade nodes (the induced backbone)

One entry per internal node kept in the induced tree.

```jsonc
{
  "id": "ord:Carnivora",
  "rank": "order",                 // kingdom|phylum|class|order|family|genus|... (+ sub-ranks)
  "sci": "Carnivora",
  "common": "carnivorans",         // nullable; UI falls back to sci
  "parent": "cls:Mammalia",        // null for root
  "pool_count": 41                 // # of pool TIPS anywhere beneath this node
}
```

- `pool_count` is the **denominator of "N remaining"** under this clade. The client
  tracks how many pool tips beneath the node have been named (`found_count`) and
  shows the hidden label when `pool_count - found_count <= hidden_label_max` and
  `found_count >= 1`. `found_count` is maintained incrementally in `O(L)` per name
  by walking the named tip's `lineage`; nothing scans all nodes. See
  [`marathon-design.md`](marathon-design.md#the-n-remaining-mechanic) and
  [`performance.md`](performance.md#n-remaining-without-a-tree-walk).
- Degree-2 nodes are kept **only** where a rank label or hint should attach;
  otherwise collapsed, so the tree has no empty filler chains.

## `tips` — playable pool species

```jsonc
{
  "id": "tip:Ursus_arctos",
  "sci": "Ursus arctos",
  "common": "brown bear",
  "parent": "gen:Ursus",
  "lineage": ["root","kng:Animalia","phy:Chordata", "...","gen:Ursus"],
  // ordered root→parent ancestor ids; MRCA(a,b) = last shared prefix element. O(L).
  "fame": 84187,                   // popularity score: enwiki monthly pageviews, with
  // Wikidata sitelink count as the fallback for taxa with no enwiki article; 0 when
  // neither is known (offline builds). Ranks the pool for the capped "notable" blob,
  // breaks ambiguous name ties (famous "robin" wins), and weights the Marathon bonus.
  "has_common": true,              // is `common` above a REAL vernacular, or the binomial
  // we fell back to? See below — `common` is never null, so this is the only way to tell.
  "has_image": true,               // does the species have a picture on Wikipedia? OMITTED
  // (not false) when the build had no way to look, e.g. an offline build.
  "traits": {                      // nameless-hint material (Stage 1 metadata)
    "environment": ["terrestrial"],
    "biomes": ["Palearctic","Nearctic"],
    "extinct": false
  }
}
```

- `lineage` is the precomputed ancestor path; it makes MRCA and "which clades does
  naming this tip complete?" a prefix walk, no tree traversal. At load it is
  interned to an `Int32Array` of node indices (see [`performance.md`](performance.md)).
- **`common` is never null on a tip** — it falls back to `sci` when no vernacular is known,
  which is the right thing for a display string and a trap for anything that needs to *know*.
  Two thirds of the Fish pack have no vernacular, so a game mode promising common names was
  quietly serving Latin (#145). **`has_common` is that boolean**, and it is stricter than
  `common != sci`: it also rejects vernaculars in other scripts ("キビレマツカサ") and synonym
  binomials Wikidata carries as alt-labels (*Abactochromis labrosus* → "Melanochromis
  labrosus"). Owned by `pipeline/enrich.py::has_vernacular`, **mirrored** in
  `frontend/src/lib/game/commonName.ts` — the mirror is what makes the flag's absence
  survivable, since it derives the same answer for packs built before the flag existed.
- **`has_image`** records whether Wikipedia has a picture, harvested in bulk at build time
  (50 titles per request). Clade Clash is played by looking at an animal, so its round
  generator draws only from species that have one (#146); fame had been standing in for this
  and leaks badly. Three states, and the third matters: `true` draw it, `false` don't,
  **absent** = this build never looked, so the client asks Wikipedia itself at draw time
  (`lib/wikiImages.ts`). Absent must never be read as `false`, or a pack built offline would
  have nothing to draw.
- `traits` feed the optional **"trait?"** Marathon reveal — surfaced about a *hidden*
  sister to nudge the player, never paired with a name.

## `aliases` — autocomplete / matching index

Resolves player text to a **tip OR an internal clade node** (clades are nameable,
animalist-style), with ambiguity decided at build time rather than at play time.
Targets are distinguishable by id prefix: `tip:` = species, anything else (`fam:`,
`ord:`, …) = clade node.

```jsonc
{
  "brown bear": ["tip:Ursus_arctos"],
  "grizzly":    ["tip:Ursus_arctos"],
  "bear":       ["tip:Ursus_arctos","tip:Ursus_maritimus", "..."], // ambiguous → disambiguate in UI
  "felidae":    ["fam:Felidae"],                                    // clade name → a node
  "cats":       ["fam:Felidae"]
}
```

- Keys are **normalized**: lowercase, punctuation dropped, and **underscores folded to
  spaces** so a Wikipedia-title source (`Brown_bear`) matches a typed "brown bear".
  Players never type underscores, and no display name (`tip.common`, `node.sci`)
  carries one. The frontend must normalize the player's query the *same* way before
  lookup. Scientific names index too.
- One key may map to several targets (genuine ambiguity); the combobox disambiguates.
  A typo that matches nothing simply doesn't resolve — no wrong "guess" is spent.
- Naming a clade target is allowed but only *rewards* the player when it places a new
  node (see [`marathon-design.md`](marathon-design.md)).

## Client-side state derived at runtime (not in the asset)

- `found_count` per node — incremented along a tip's `lineage` when it is named;
  drives the hidden labels.
- The **induced display tree** — the current Steiner subtree over named tips; grown
  incrementally as tips arrive.
- Timer / score (Marathon), proximity bars + guess history (Classic).

## Validation

The pipeline emits the asset only if it passes structural checks — these are the
asset's conformance contract:

- Every `tip.parent` and `node.parent` resolves; exactly one root; no cycles.
- `node.pool_count` equals the count of pool tips actually beneath it (recomputed,
  not trusted).
- Every `tip.lineage` is a valid root→parent path ending at `tip.parent`.
- Every alias target is a real tip id.
- `tips.length == pool_size`.
