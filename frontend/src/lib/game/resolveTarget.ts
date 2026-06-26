// Unified name→Target resolution across both delivery modes, so the Marathon submit
// path doesn't branch on mode beyond `await`:
//   * blob mode   — synchronous lookup in the baked alias index (resolve()).
//   * remote mode — /search for candidates, /resolve the best one, fold its lineage into
//     the growing asset, return the Target. The server-side hit is cached, so re-typing a
//     placed organism never re-fetches.
// See docs/architecture.md#scaling-to-huge-scope and AGENTS.md (keep the server light).

import { foldResolved } from "../asset/growable";
import { mightContain } from "../asset/membership";
import { resolveByName } from "../asset/remote";
import type { InternedAsset, Target, TailSource } from "../asset/types";
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
  // Gate the tail: a repeat miss is rejected locally — no network at all.
  if (asset.negativeCache?.has(q)) return null;

  // Tail components: a MIXED asset carries one per hybrid/remote pack (membership is per-scope,
  // never unioned); a single-scope asset has just its own scope + filter.
  const sources: TailSource[] = asset.tailSources ?? [
    { scope: asset.scope ?? "", version: asset.raw.version, filter: asset.filter },
  ];
  // A component can hold the name only if its filter says "maybe" (or it has none). If EVERY
  // component definitively rejects it, it's a guaranteed miss — cache it and skip the network.
  // Order by pack size ASCENDING so the SMALLER PACK WINS an overlap (same rule as resolve.ts):
  // the first component that returns a hit is accepted, so the smallest is tried first.
  const candidates = sources
    .filter((s) => !s.filter || mightContain(s.filter, q))
    .sort((a, b) => (a.size ?? Infinity) - (b.size ?? Infinity));
  if (candidates.length === 0) {
    asset.negativeCache?.add(q);
    return null;
  }

  // Try each candidate backend in turn; the first exact hit wins. Smaller packs are tried first
  // (above), so an overlapping name resolves to the more specialised pack — consistent with the
  // local resolve() rule. (Within a pack the server still applies its own fame tie-break.)
  for (const src of candidates) {
    // Exact name → full placement payload in one call (server-side O(log n) btree equality,
    // immutable + cached). The most-famous taxon wins a shared name WITHIN a scope.
    const payload = await resolveByName(src.scope, q, src.version);
    if (!payload) continue;
    const target = foldResolved(asset, payload);
    // Scientific difficulty: only the actual scientific name counts (common-name aliases can
    // match, so gate the resolved target on its sci name here too); a near-miss tries the next.
    if (target && scientificOnly) {
      const sci = target.kind === "tip" ? target.tip.sci : target.node.sci;
      if (normalize(sci) !== q) continue;
    }
    return target;
  }
  asset.negativeCache?.add(q);
  return null;
}
