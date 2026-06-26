// resolve(query) — turn typed text into a placement target (a species tip or a
// nameable clade node), or null. Comprehensiveness, not fuzzy matching: a single
// normalize() lookup in the baked alias index, then a deterministic tie-break.
// See docs/marathon-design.md#name-resolution.

import type { InternedAsset, Target } from "../asset/types";
import { normalize } from "./normalize";

/** Node ids strictly above a target (a tip's lineage, or a node's parent chain). */
function ancestorsOf(asset: InternedAsset, id: string): Set<string> {
  const tip = asset.tipById.get(id);
  if (tip) return new Set(tip.lineage);
  const out = new Set<string>();
  let cur = asset.nodeById.get(id)?.parent ?? null;
  while (cur) {
    out.add(cur);
    cur = asset.nodeById.get(cur)?.parent ?? null;
  }
  return out;
}

function toTarget(asset: InternedAsset, id: string): Target | null {
  const tip = asset.tipById.get(id);
  if (tip) return { kind: "tip", id, tip };
  const node = asset.nodeById.get(id);
  if (node) return { kind: "node", id, node };
  return null;
}

/** Does this target's OWN canonical name (common/sci) equal the query? A "primary"
 *  match outranks an incidental alias — this is what makes "bear" pick Ursidae (whose
 *  name *is* "Bear") over the brown bear (which merely carries "bear" as an alias). */
function sciOf(t: Target): string {
  return t.kind === "tip" ? t.tip.sci : t.node.sci;
}

/** Popularity of a target — tips carry a fame score; clade nodes have none (0). */
function fameOf(t: Target): number {
  return t.kind === "tip" ? t.tip.fame ?? 0 : 0;
}

function isPrimary(t: Target, q: string): boolean {
  const common = t.kind === "tip" ? t.tip.common : t.node.common;
  return normalize(sciOf(t)) === q || (common != null && normalize(common) === q);
}

/**
 * resolve a typed name to a target.
 *
 * `scientificOnly` (the Scientific difficulty) accepts ONLY the actual scientific name —
 * common-name aliases like "lion" must NOT resolve, even though they're in the alias
 * index. We still look candidates up via the alias index (it maps every name, sci
 * included), then keep only those whose canonical scientific name *is* the query.
 */
export function resolve(asset: InternedAsset, query: string, scientificOnly = false): Target | null {
  const q = normalize(query);
  if (!q) return null;

  const ids = asset.raw.aliases[q];
  if (!ids || ids.length === 0) return null;

  let cands = ids.map((id) => toTarget(asset, id)).filter((t): t is Target => t !== null);
  if (scientificOnly) cands = cands.filter((t) => normalize(sciOf(t)) === q);
  if (cands.length === 0) return null;
  if (cands.length === 1) return cands[0];

  // 0) SMALLER PACK WINS (mixed packs only). When a name overlaps across the merged packs —
  //    e.g. "wolf" is both a fish (pike) and a mammal — the smaller pack is the more
  //    specialised, intentional pick, so keep only candidates from the smallest pack present
  //    and let the rules below settle it WITHIN that pack. `packSize` is set only for a merged
  //    asset (single-pack play has no overlap), so this is a no-op there. See
  //    docs/lobby-and-config.md#name-collisions.
  if (asset.packSize) {
    let min = Infinity;
    for (const t of cands) min = Math.min(min, asset.packSize.get(t.id) ?? Infinity);
    if (min < Infinity) {
      const smallest = cands.filter((t) => (asset.packSize!.get(t.id) ?? Infinity) === min);
      if (smallest.length > 0) cands = smallest;
      if (cands.length === 1) return cands[0];
    }
  }

  // 1) Prefer candidates whose own canonical name is exactly what was typed.
  const primary = cands.filter((t) => isPrimary(t, q));
  if (primary.length > 0) cands = primary;
  if (cands.length === 1) return cands[0];

  // 2) Drop any candidate that is an ancestor of another (so "hippopotamus" -> the
  //    species, not its genus). Keep the most specific.
  const ancestorSets = new Map(cands.map((t) => [t.id, ancestorsOf(asset, t.id)] as const));
  const specific = cands.filter(
    (c) => !cands.some((d) => d.id !== c.id && ancestorSets.get(d.id)!.has(c.id)),
  );
  if (specific.length > 0) cands = specific;

  // 3) Genuine ambiguity (e.g. "elk" = wapiti/moose) -> the more famous taxon
  //    (enwiki pageviews), with id as the deterministic final tie-break.
  cands.sort((a, b) => fameOf(b) - fameOf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return cands[0];
}
