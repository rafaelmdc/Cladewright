# pipeline

The offline ETL that turns a Catalogue of Life dump into the game-data asset.
Driven by `manage.py build_gamedata`; **never** imported by request handlers. Full
design: [`../../docs/data-pipeline.md`](../../docs/data-pipeline.md). Output
contract: [`../../docs/game-asset-format.md`](../../docs/game-asset-format.md).

Stages (one module each):

| Module | Stage | Uses |
|---|---|---|
| `ingest.py`   | ColDP → tips + ranked lineage + biomes + CoL vernacular | in-repo (reads `NameUsage` + `VernacularName.tsv` directly) |
| `backbone.py` | denormalized lineages → one rooted tree | — |
| `pool.py`     | select playable tips (all non-extinct by default; capped mode optional) | — |
| `enrich.py`   | fill common-name gaps (Wikidata label/altLabel/vernacular, enwiki title, P13176) | **Braidworks** weaver |
| `asset.py`    | precompute induced backbone, counts, lineages, aliases → emit | — |
| `validate.py` | structural conformance checks before write | — |

Keep builds reproducible — a pure function of (dump, pinned dep versions, pool config);
no unseeded randomness, no wall-clock ordering.

## The only external dependency: Braidworks

ColDP ingest is in-repo (`ingest.py` reads the dump directly — there is no external ingest
package). The pipeline's one external dependency is **Braidworks** (enrichment), pinned from
GitHub in `requirements-pipeline.txt` and installed only on the worker. The common-name
enrichment is a **Braidworks weaver** (`wikidata_weaver`) built in the Braidworks repo via
its Spec→Scaffold→Implement→Verify loop, then consumed here. (The popularity/obscurity "fame"
system — Wikipedia pageviews — is post-MVP; the pool is all species, so nothing gates
inclusion on fame.)
