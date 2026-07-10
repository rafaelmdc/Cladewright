# Cladewright docs — index & routing

The design of record for Cladewright. Start here, then jump to the one doc that
answers your question — don't read all of them. New to the repo? Read
[`../README.md`](../README.md) (what it is) then [`architecture.md`](architecture.md)
(how it fits together). Contributing (agent or human)? Read [`../AGENTS.md`](../AGENTS.md).

## Find the right doc

| I want to… | Read |
|---|---|
| Understand the system + the boundaries (why it's shaped this way) | [`architecture.md`](architecture.md) |
| Change the **game-data asset** shape (the pipeline↔app contract) | [`game-asset-format.md`](game-asset-format.md) |
| Work on how the asset is **built** from Catalogue of Life | [`data-pipeline.md`](data-pipeline.md) |
| Build/serve a scope, or run a build job from the admin | [`pipeline-jobs.md`](pipeline-jobs.md) + [`admin.md`](admin.md) |
| Touch the **Time-attack** game loop (the tree, "N remaining", scoring) | [`marathon-design.md`](marathon-design.md) |
| Understand the **Clade Clash** distance-guessing mode (designed, not built) | [`clade-clash-design.md`](clade-clash-design.md) |
| Touch anything in the **play loop** (perf rules — read before editing) | [`performance.md`](performance.md) |
| Understand modes / difficulty / the daily / leaderboards / streak | [`games-model.md`](games-model.md) |
| Run the app locally | [`development.md`](development.md) |
| Deploy, or recover a stuck worker / confirm a build is live | [`deployment.md`](deployment.md) |
| Operate the admin (build assets, prune/purge, moderate) | [`admin.md`](admin.md) |
| Ship a huge scope (Arthropods / all-invertebrates / all-Animalia) | [`huge-scope-hybrid.md`](huge-scope-hybrid.md) |

## The docs, by kind

**Design of record** — the *why*, and the invariants to preserve:
- [`architecture.md`](architecture.md) — system shape, data flow, the load-bearing boundaries.
- [`game-asset-format.md`](game-asset-format.md) — the asset schema; a real interface, versioned.
- [`marathon-design.md`](marathon-design.md) — the Time-attack mechanic + the anti-clutter rules.
- [`performance.md`](performance.md) — the `O(L)` hot-path design; rules the play loop must obey.
- [`games-model.md`](games-model.md) — game = (mode × difficulty), the daily, scoring, leaderboards.

**Process & reference** — the *how*:
- [`data-pipeline.md`](data-pipeline.md) — ColDP → asset, the offline build.
- [`pipeline-jobs.md`](pipeline-jobs.md) — copy-paste build-job values per scope.
- [`development.md`](development.md) — repo layout + local run.
- [`deployment.md`](deployment.md) — k8s/Argo/Cloudflare, env/secrets, and operational runbooks.
- [`admin.md`](admin.md) — the Django admin surface.

**Deferred** — designed, not built:
- [`huge-scope-hybrid.md`](huge-scope-hybrid.md) — notable-blob + membership-filter + remote-tail
  delivery for scopes too big to ship whole (tracked in [issues](https://github.com/rafaelmdc/Cladewright/issues): #42, #13, #14).
- [`clade-clash-design.md`](clade-clash-design.md) — the distance-guessing mode: nodal-distance
  metric, a bot opponent, and a single-ASGI realtime 1v1 (tracked in #36; shares a distance
  primitive with #126/#127).

`examples/` holds the low-fi wireframes the UI was built from.

## Conventions (keep the docs healthy)

- **One home per fact.** Each concept lives in exactly one doc; others link to it. If
  you're tempted to re-explain something, link instead.
- **The asset format is a contract.** Changing [`game-asset-format.md`](game-asset-format.md)
  means changing both the pipeline and the app — do it deliberately and bump `version`.
- **Update the doc with the change, in the same PR.** A decision that changes behaviour
  changes its doc. Stale docs are worse than none.
- **Roadmap/future work lives in GitHub issues, not here.** Docs describe what *is* (and the
  deferred designs we've committed to), not a build schedule — schedules rot.
- **Player-facing vs internal names:** the primary game is shown as **"Time attack"** in the
  UI; internally it's still `marathon_free` (the mode key), the `/marathon` route, and
  `marathon-design.md`. Don't rename the keys/route — they anchor data and links.
