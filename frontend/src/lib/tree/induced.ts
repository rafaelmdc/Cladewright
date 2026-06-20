// The induced display tree: the minimal subtree connecting named tips through their
// MRCAs. Grown incrementally — never rebuilt — using a `present` bitset over node
// indices. Attaching a tip is O(L): walk its lineage to find the deepest node already
// present (the attach point), then insert at most one new branch node + the tip.
// See docs/performance.md#induced-display-tree--grown-never-rebuilt.

import type { InternedAsset } from "../asset/types";

export interface InducedTree {
  /** node indices currently in the display tree */
  present: Set<number>;
  /** tip ids placed so far, in order */
  tips: string[];
}

export function createInducedTree(): InducedTree {
  return { present: new Set(), tips: [] };
}

/**
 * Add a named tip to the display tree. O(L).
 * TODO(phase-2/3): return the structural delta (new nodes/edges) so the renderer can
 * animate just the change rather than diffing the whole tree.
 */
export function addTip(asset: InternedAsset, tree: InducedTree, tipId: string): void {
  const lineage = asset.tipLineage.get(tipId);
  if (!lineage) return;
  // Mark the full root→parent path present (idempotent); the attach point is the
  // deepest node that was already present before this insert.
  for (let k = 0; k < lineage.length; k++) {
    if (lineage[k] >= 0) tree.present.add(lineage[k]);
  }
  tree.tips.push(tipId);
}
