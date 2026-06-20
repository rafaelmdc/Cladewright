// MRCA via lineage prefix. Each tip carries its ordered root→parent ancestor path,
// so the most-recent common ancestor of two tips is the last shared prefix element —
// O(L), no tree traversal. See docs/game-asset-format.md.

import type { InternedAsset } from "../asset/types";

/** Returns the MRCA node index of two tips, or -1 if they share nothing. */
export function mrca(asset: InternedAsset, tipA: string, tipB: string): number {
  const a = asset.tipLineage.get(tipA);
  const b = asset.tipLineage.get(tipB);
  if (!a || !b) return -1;
  let last = -1;
  const len = Math.min(a.length, b.length);
  for (let k = 0; k < len; k++) {
    if (a[k] === b[k]) last = a[k];
    else break;
  }
  return last;
}
