// Unified name→Target resolution across both delivery modes, so the Marathon submit
// path doesn't branch on mode beyond `await`:
//   * blob mode   — synchronous lookup in the baked alias index (resolve()).
//   * remote mode — /search for candidates, /resolve the best one, fold its lineage into
//     the growing asset, return the Target. The server-side hit is cached, so re-typing a
//     placed organism never re-fetches.
// See docs/architecture.md#scaling-to-huge-scope and AGENTS.md (keep the server light).

import { foldResolved } from "../asset/growable";
import { resolveRemote, searchRemote } from "../asset/remote";
import type { InternedAsset, Target } from "../asset/types";
import { normalize } from "./normalize";
import { resolve } from "./resolve";

export async function resolveTarget(asset: InternedAsset, query: string): Promise<Target | null> {
  if (asset.mode === "blob") return resolve(asset, query);

  const hits = await searchRemote(asset.scope, query);
  if (hits.length === 0) return null;
  // /search already ranks exact→prefix→shortest; prefer an exact name match, else the top
  // hit (mirrors the local resolver preferring a primary name).
  const norm = normalize(query);
  const best = hits.find((h) => h.name === norm) ?? hits[0];

  const payload = await resolveRemote(asset.scope, best.id);
  if (!payload) return null;
  return foldResolved(asset, payload);
}
