// Unified name→Target resolution across both delivery modes, so the Marathon submit
// path doesn't branch on mode beyond `await`:
//   * blob mode   — synchronous lookup in the baked alias index (resolve()).
//   * remote mode — /search for candidates, /resolve the best one, fold its lineage into
//     the growing asset, return the Target. The server-side hit is cached, so re-typing a
//     placed organism never re-fetches.
// See docs/architecture.md#scaling-to-huge-scope and AGENTS.md (keep the server light).

import { foldResolved } from "../asset/growable";
import { mightContain } from "../asset/membership";
import { resolveRemote, searchRemote } from "../asset/remote";
import type { InternedAsset, Target } from "../asset/types";
import { normalize } from "./normalize";
import { resolve } from "./resolve";

export async function resolveTarget(
  asset: InternedAsset,
  query: string,
  scientificOnly = false,
): Promise<Target | null> {
  if (asset.mode === "blob") return resolve(asset, query, scientificOnly);

  // Hybrid: the famous ~99% resolve locally in the baked notable-blob index; only a genuine
  // tail miss falls through to the remote /search + /resolve path below.
  if (asset.mode === "hybrid") {
    const local = resolve(asset, query, scientificOnly);
    if (local) return local;
  }

  const q = normalize(query);
  // Gate the tail: a repeat miss, or a name the membership filter says is "definitely
  // absent" (a typo / out-of-scope guess), is rejected locally — no network at all.
  if (asset.negativeCache?.has(q)) return null;
  if (asset.filter && !mightContain(asset.filter, q)) {
    asset.negativeCache?.add(q);
    return null;
  }

  const version = asset.raw.version;
  const hits = await searchRemote(asset.scope, query, version);
  if (hits.length === 0) {
    asset.negativeCache?.add(q);
    return null;
  }
  // /search already ranks exact→prefix→fame→shortest; prefer an exact name match, else the
  // top hit (mirrors the local resolver preferring a primary name).
  const best = hits.find((h) => h.name === q) ?? hits[0];

  const payload = await resolveRemote(asset.scope, best.id, version);
  if (!payload) {
    asset.negativeCache?.add(q);
    return null;
  }
  const target = foldResolved(asset, payload);
  // Scientific difficulty: only the actual scientific name counts (common-name aliases
  // can match /search, so gate the resolved target on its sci name here too).
  if (target && scientificOnly) {
    const sci = target.kind === "tip" ? target.tip.sci : target.node.sci;
    if (normalize(sci) !== q) return null;
  }
  return target;
}
