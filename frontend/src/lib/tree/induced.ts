// The induced display tree: the minimal subtree connecting named tips (and named
// clades) through their MRCAs. Grown incrementally — never rebuilt — using a `present`
// set over node indices. Attaching a tip is O(L): mark its root→parent lineage present;
// the deepest node already present is the attach point.
// See docs/performance.md#induced-display-tree--grown-never-rebuilt.

import type { InternedAsset, Target } from "../asset/types";

export interface InducedTree {
  /** node indices currently in the display tree (on some placed item's path) */
  present: Set<number>;
  /** placed tip ids, in order */
  tips: string[];
  /** clade-node indices the player explicitly named (vs. merely on a tip's path) */
  namedNodes: Set<number>;
  /** node indices that are an explicitly placed leaf-of-record (named clade with no
   *  named descendant yet) — used for the refinement reward rule */
  namedTips: Set<string>;
}

export type PlacementKind = "new" | "refinement" | "duplicate";

export interface Placement {
  kind: PlacementKind;
  target: Target;
  /** index of the deepest node already present before this insert (the attach point),
   *  or -1 if this is the first placement */
  mrcaIdx: number;
}

export function createInducedTree(): InducedTree {
  return { present: new Set(), tips: [], namedNodes: new Set(), namedTips: new Set() };
}

/** Mark every node on a root→parent lineage present; return the deepest index that was
 *  ALREADY present before this call (the attach point / MRCA with the existing tree). */
function markLineage(tree: InducedTree, lineage: Int32Array): number {
  let attach = -1;
  for (let k = 0; k < lineage.length; k++) {
    const idx = lineage[k];
    if (idx < 0) continue;
    if (tree.present.has(idx)) attach = idx;
    tree.present.add(idx);
  }
  return attach;
}

/**
 * Place a resolved target (tip or clade) onto the display tree. Returns the reward
 * classification (docs/marathon-design.md#reward-tiers):
 *   - new        — no already-placed ancestor or descendant → full reward
 *   - refinement — sits below a clade you already named → small reward
 *   - duplicate  — already placed, or an ancestor of what you have → no reward
 * O(L). Caller decides time/score from the kind + mrcaIdx (novelty).
 */
export function place(asset: InternedAsset, tree: InducedTree, target: Target): Placement {
  if (target.kind === "tip") {
    const lineage = asset.tipLineage.get(target.id)!;
    if (tree.namedTips.has(target.id)) {
      return { kind: "duplicate", target, mrcaIdx: lineage[lineage.length - 1] ?? -1 };
    }
    // Refinement iff some ancestor clade was explicitly named (you're getting specific
    // under a group you already have).
    const refining = lineage.some((idx) => idx >= 0 && tree.namedNodes.has(idx));
    const attach = markLineage(tree, lineage);
    tree.tips.push(target.id);
    tree.namedTips.add(target.id);
    return { kind: refining ? "refinement" : "new", target, mrcaIdx: attach };
  }

  // Clade node: build its root→self lineage from parent pointers.
  const nodeIdx = asset.nodeIndex.get(target.id);
  if (nodeIdx === undefined) return { kind: "duplicate", target, mrcaIdx: -1 };

  if (tree.namedNodes.has(nodeIdx)) {
    return { kind: "duplicate", target, mrcaIdx: nodeIdx };
  }
  // A clade already implied by a deeper placement (it's an ancestor of something you
  // have) pays nothing — climbing up to a node already present.
  const alreadyPresent = tree.present.has(nodeIdx);

  const chain: number[] = [];
  for (let cur: number = nodeIdx; cur >= 0; cur = asset.parent[cur]) chain.push(cur);
  chain.reverse();
  const attach = markLineage(tree, Int32Array.from(chain));
  tree.namedNodes.add(nodeIdx);

  return { kind: alreadyPresent ? "duplicate" : "new", target, mrcaIdx: attach };
}
