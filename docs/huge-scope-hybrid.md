# Huge-scope delivery — the hybrid plan (deferred)

> **Status: design note, not built.** Parked deliberately (see issues #13, #14, #25).
> Do the rest first; pick this up when huge scopes (Arthropods, non-arthropod
> invertebrates, all-Animalia) are on the table. Decide on **measured** numbers.

## The problem

A few scopes are too big to ship as a blob, even gzipped (modelled from the asset
format, calibrated on Mammalia ≈ 0.5 MB gzip):

| scope | pool species | gzipped blob |
|---|---|---|
| Arthropoda (full) | ~1.25 M | **~95 MB** |
| non-arthropod inverts (full) | ~350 k | ~27 MB |
| capped ~100 k | 100 k | ~8 MB |
| capped ~15 k | 15 k | ~1.2 MB |

Pure remote mode (`/search` + `/resolve` for everything) covers it but is the heavy
path we want to avoid as the *default*.

## The design: capped blob + membership filter + remote tail

1. **Capped "notable" blob.** Bundle the top-N *most common* species as the normal
   immutable, CDN-cached blob (~1–2 MB). Loads fast; covers ~99% of what players type.
2. **Approximate-membership filter** (Bloom / xor / **binary-fuse**) over **every**
   valid normalized key (all species + clades + common names + plurals — the full
   `index_keys` set), bundled with the blob. ~1 byte/key → ~3 MB for ~3 M keys.
3. **Remote tail.** On a local-alias miss, query the filter *before* any network:
   - **"definitely absent"** → wrong guess / typo → **reject locally, no network.**
   - **"possibly present"** → real tail species → `/resolve`, grow the asset.
4. **Negative-result cache** so a leaked false-positive or repeated typo hits remote
   at most once.

Net: remote traffic ≈ *distinct real obscure species ever guessed* — tiny and
self-caching. Wrong guesses (frequent in a guessing game) never reach the network.

## Why this resolves the open tensions

- **Coverage vs size** (the "real biologists" mission): the cap is only a *prefetch
  hint*, not the species list — **all** species stay reachable via the tail. No painful
  "which 100k do we keep" cut.
- **"Remote is heavy"**: remote becomes a rare-miss path, not the primary one.
- **Scope-mix (#25)**: every scope is "blob + optional remote tail", so mixing is
  always "merge blobs, share one remote fallback" — no pure-remote special case.

## Heuristics — must be very good

- **Ranking = Wikipedia pageviews** (the post-MVP "fame" system; a Braidworks weaver,
  like names). Bundle the top-N by pageviews. Reuse it for the time-bonus too.
- **Filter is safe by construction**: Bloom/xor/binary-fuse have **no false
  negatives** — a real, inserted name is *never* answered "absent", so a true species
  is **never** wrongly rejected. The only error is harmless (a fake name occasionally
  reaching remote). The real safety work is **key coverage**: insert every alias a
  player might type (synonyms, vernaculars, plurals). On *any* uncertainty, fall
  through to remote rather than reject.
- **Remote must be fast**: keep `/resolve` a single indexed row read; push it to the
  CDN edge (cache-control + ETag, like the blob) so the tail resolves from cache after
  the first global hit. One round-trip, zero per-guess compute.

## Build / serve implications

- One build populates **both**: the full relational tables (`TaxonTip` / `TaxonNode` /
  `Alias` — what `/search` + `/resolve` read) **and** a capped `AssetVersion.blob`
  (the notable subset) **and** the membership filter.
- `ScopesView` gains a **`hybrid`** mode (blob present *and* remote tables present).
- Client: load blob → growable asset (seed `growable.ts` from the blob instead of
  empty); on filter-pass miss, remote-resolve + grow. Autocomplete = local hits +
  debounced `/search` for the tail.
- Needs a `--pool-size` / pageview-ranked cap in `build_gamedata` + the starter-scope
  manifest, and the filter artifact in the asset format (bump `schema`).

## Sizing levers (if more pre-bundled coverage is wanted)

- **Columnar / int-indexed wire format** (docs/performance.md's suggested next step):
  ~2–4× smaller per tip → more species per MB before the cap bites.
- Higher cap (100 k ≈ ~8 MB one-time cached) if a fuller offline pool is wanted.
