// Client-side "scope mixing": merge several blob-mode game assets into one playable asset.
//
// Node ids are deterministic across builds (kng:Animalia, phy:Chordata, cls:Mammalia…), so
// the per-class assets SHARE their upper backbone. Deduping nodes by id and SUMMING their
// pool counts yields one biologically-correct tree (mammals + birds both under Chordata),
// not a forest. Tip sets are disjoint across scopes (concat); aliases union per key.

import type { AssetNode, AssetTip, GameAsset } from "./types";

export function mergeAssets(assets: GameAsset[]): GameAsset {
  if (assets.length === 1) return assets[0];

  // Nodes: dedup by id. A shared backbone node (Animalia, Chordata) has, beneath it, the
  // UNION of each scope's pool — and since the tip sets are disjoint, the counts add.
  const nodeById = new Map<string, AssetNode>();
  for (const a of assets) {
    for (const n of a.nodes) {
      const cur = nodeById.get(n.id);
      if (!cur) {
        nodeById.set(n.id, { ...n });
        continue;
      }
      // Capture extant before mutating pool_count (it feeds the fallback below).
      const curExtant = cur.pool_count_extant ?? cur.pool_count;
      const nExtant = n.pool_count_extant ?? n.pool_count;
      cur.pool_count += n.pool_count;
      cur.pool_count_extant = curExtant + nExtant;
    }
  }

  // Tips: concat (ids are unique per species; guard against a species in two scopes).
  const tipById = new Map<string, AssetTip>();
  for (const a of assets) for (const t of a.tips) if (!tipById.has(t.id)) tipById.set(t.id, t);

  // Aliases: union the target-id list per normalized key, deduped.
  const aliases: Record<string, string[]> = {};
  for (const a of assets) {
    for (const key in a.aliases) {
      const into = aliases[key] ?? (aliases[key] = []);
      for (const id of a.aliases[key]) if (!into.includes(id)) into.push(id);
    }
  }

  // Deterministic combined identity (sorted, so "mammalia+aves" === "aves+mammalia").
  const ordered = [...assets].sort((x, y) => (x.scope < y.scope ? -1 : x.scope > y.scope ? 1 : 0));
  return {
    version: Math.max(...assets.map((a) => a.version || 0)),
    schema: assets[0].schema,
    scope: ordered.map((a) => a.scope).join("+"),
    label: ordered.map((a) => a.label ?? a.scope).join(" + "),
    pool_size: assets.reduce((s, a) => s + a.pool_size, 0),
    pool_size_extant: assets.reduce((s, a) => s + (a.pool_size_extant ?? a.pool_size), 0),
    thresholds: { hidden_label_max: Math.max(...assets.map((a) => a.thresholds.hidden_label_max)) },
    provenance: {},
    nodes: [...nodeById.values()],
    tips: [...tipById.values()],
    aliases,
  };
}
