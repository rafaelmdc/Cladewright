# pipeline

The offline ETL that turns a Catalogue of Life dump into the game-data asset.
Driven by `manage.py build_gamedata`; **never** imported by request handlers. Full
design: [`../../docs/data-pipeline.md`](../../docs/data-pipeline.md). Output
contract: [`../../docs/game-asset-format.md`](../../docs/game-asset-format.md).

Stages (one module each):

| Module | Stage | Uses |
|---|---|---|
| `ingest.py`   | ColDP → tips + ranked lineage + biomes + CoL vernacular | **BICHO** (+ read `VernacularName.tsv`) |
| `backbone.py` | denormalized lineages → one rooted tree | — |
| `pool.py`     | select playable tips (all non-extinct by default; capped mode optional) | — |
| `enrich.py`   | fill common-name gaps (Wikidata label/altLabel/vernacular, enwiki title, P13176) | **Braidworks** weaver |
| `asset.py`    | precompute induced backbone, counts, lineages, aliases → emit | — |
| `validate.py` | structural conformance checks before write | — |

Phase 0: every function is a stub raising `NotImplementedError`. Phase 1 implements
them. Keep builds reproducible — pure function of (dump, pinned dep versions, pool
config); no unseeded randomness, no wall-clock ordering.

## Wiring BICHO and Braidworks

Both are sibling repos imported as deps (see `backend/pyproject.toml [pipeline]`).
BICHO's `taxa ingest` does not currently read `VernacularName.tsv` — either extend
it or read that side table directly here. The common-name enrichment is added as a
**Braidworks weaver** (`wikidata_weaver`) in the Braidworks repo via its
Spec→Scaffold→Implement→Verify loop, then consumed here. (The popularity/obscurity
"fame" system — Wikipedia pageviews — is post-MVP; the pool is all species, so nothing
gates inclusion on fame.)
