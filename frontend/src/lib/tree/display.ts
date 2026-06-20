// Build the nested render hierarchy from the induced-tree state. This is the bridge
// between the integer-indexed game state and d3-hierarchy, which the renderer lays out
// radially. Two readability rules from docs/marathon-design.md are applied here:
//   - degree-2 collapse: long single-child backbone chains render as one edge, so the
//     canvas shows the minimal MRCA tree, not every intermediate rank.
//   - deepest-branch "N hidden": among eligible ancestors on a path, only the deepest
//     shows its count; shallower ones roll up (suppressed unless expanded later).

import type { InternedAsset } from "../asset/types";
import type { RemainingTracker } from "../game/remaining";
import type { InducedTree } from "./induced";

export interface RenderNode {
  key: string; // stable id (node id or tip id) — animation key
  kind: "node" | "tip";
  label: string;
  rank?: string;
  remaining: number; // hidden-sister count (nodes only; 0 for tips)
  showHidden: boolean; // this node displays its "N hidden" label
  children: RenderNode[];
}

export function buildDisplayTree(
  asset: InternedAsset,
  tree: InducedTree,
  tracker: RemainingTracker,
): RenderNode | null {
  if (tree.present.size === 0) return null;

  // present children of each present node, and placed tips grouped by parent node.
  const childNodes = new Map<number, number[]>();
  let rootIdx = -1;
  for (const idx of tree.present) {
    const p = asset.parent[idx];
    if (p >= 0 && tree.present.has(p)) {
      (childNodes.get(p) ?? childNodes.set(p, []).get(p)!).push(idx);
    } else {
      rootIdx = idx; // no present parent → display root
    }
  }
  const tipsByParent = new Map<number, string[]>();
  for (const tipId of tree.tips) {
    const node = asset.tipById.get(tipId)!;
    const pIdx = asset.nodeIndex.get(node.parent);
    if (pIdx === undefined) continue;
    (tipsByParent.get(pIdx) ?? tipsByParent.set(pIdx, []).get(pIdx)!).push(tipId);
  }

  if (rootIdx < 0) return null;

  const build = (idx: number): RenderNode => {
    const node = asset.raw.nodes[idx];
    const kids: RenderNode[] = [];
    for (const c of childNodes.get(idx) ?? []) kids.push(build(c));
    for (const tipId of tipsByParent.get(idx) ?? []) {
      const tip = asset.tipById.get(tipId)!;
      kids.push({ key: tipId, kind: "tip", label: tip.common, remaining: 0, showHidden: false, children: [] });
    }

    const eligible = tracker.activeLabels.has(idx);
    const descendantShows = kids.some((k) => k.showHidden || subtreeShows(k));
    return {
      key: node.id,
      kind: "node",
      label: node.common ?? node.sci,
      rank: node.rank,
      remaining: tracker.remaining(idx),
      showHidden: eligible && !descendantShows, // deepest-branch placement
      children: kids,
    };
  };

  const root = build(rootIdx);
  return collapse(root);
}

function subtreeShows(n: RenderNode): boolean {
  return n.showHidden || n.children.some(subtreeShows);
}

/** Collapse degree-2 backbone chains: a clade node with exactly one child, no hidden
 *  label, isn't worth a row of its own — splice it out so the chain renders as one
 *  edge. Tips and labelled/branching nodes always survive. */
function collapse(n: RenderNode): RenderNode {
  const children = n.children.map(collapse);
  if (
    n.kind === "node" &&
    children.length === 1 &&
    children[0].kind === "node" &&
    !n.showHidden
  ) {
    return children[0];
  }
  return { ...n, children };
}
