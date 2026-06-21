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
  sci?: string; // scientific name (tips) — shown under the common name when enabled
  rank?: string;
  remaining: number; // hidden-sister count (nodes only; 0 for tips)
  showHidden: boolean; // this node displays its "N hidden" label
  children: RenderNode[];
  ghost?: boolean; // a not-yet-named species/clade revealed at game-over (#24)
  // --- set by the collapse pass (see collapse.ts) ---
  collapsed?: boolean; // rendered as a single wedge; its subtree is hidden
  collapsedCount?: number; // # of placed species folded under the wedge
}

export function buildDisplayTree(
  asset: InternedAsset,
  tree: InducedTree,
  tracker: RemainingTracker,
  // Game-over reveal: beneath each reached clade that still hides species, attach the
  // un-named pool members as "ghost" nodes so the player sees what they missed. Blob mode
  // only (remote mode has no full raw.nodes/raw.tips to enumerate the unreached pool).
  reveal = false,
): RenderNode | null {
  if (tree.present.size === 0) return null;

  const ghostsUnder = reveal && asset.mode === "blob" ? makeGhostBuilder(asset, tree) : null;

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
    // Look up by id, not asset.raw.nodes[idx]: remote mode has no raw.nodes array (the
    // tree is grown into nodeById/nodeIds), and this works identically in blob mode.
    const node = asset.nodeById.get(asset.nodeIds[idx])!;
    const kids: RenderNode[] = [];
    for (const c of childNodes.get(idx) ?? []) kids.push(build(c));
    for (const tipId of tipsByParent.get(idx) ?? []) {
      const tip = asset.tipById.get(tipId)!;
      kids.push({ key: tipId, kind: "tip", label: tip.common, sci: tip.sci, remaining: 0, showHidden: false, children: [] });
    }
    // Deterministic sibling order: the tree shape is a function of WHICH items are
    // placed, never the order they were typed. Without this, children landed in
    // `present`-set insertion order, so branches interleaved by typing sequence and
    // sparse twigs got slotted next to dense clusters (boar appearing beside the deer
    // cluster). Sorting by stable key keeps the radial layout stable as play grows.
    kids.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const remaining = tracker.remaining(idx);
    const eligible = tracker.activeLabels.has(idx);
    const descendantShows = kids.some((k) => k.showHidden || subtreeShows(k));
    // deepest-branch placement; "0 hidden" is meaningless clutter (you've found
    // everything under this node), so a fully-found node shows no label.
    const showHidden = eligible && !descendantShows && remaining > 0;
    // Game-over reveal: ONLY the nodes that carry a "N hidden" label sprout their missed
    // members as ghosts — exactly the branches you partially explored, never the whole tree.
    if (ghostsUnder && showHidden) kids.push(...ghostsUnder(node.id));
    return {
      key: node.id,
      kind: "node",
      label: node.common ?? node.sci,
      rank: node.rank,
      remaining,
      showHidden,
      children: kids,
    };
  };

  const root = build(rootIdx);
  return collapse(root);
}

/** Build the un-named descendants of a backbone node as ghost RenderNodes — the missed
 *  species/clades beneath a "N hidden" label, revealed at game-over. Indexes the full
 *  backbone (raw.nodes/raw.tips) once; skips anything already named/present. */
function makeGhostBuilder(
  asset: InternedAsset,
  tree: InducedTree,
): (nodeId: string) => RenderNode[] {
  const nodeKidsByParent = new Map<string, string[]>();
  for (const n of asset.raw.nodes) {
    if (n.parent) (nodeKidsByParent.get(n.parent) ?? nodeKidsByParent.set(n.parent, []).get(n.parent)!).push(n.id);
  }
  const tipsByParentId = new Map<string, string[]>();
  for (const t of asset.raw.tips) {
    (tipsByParentId.get(t.parent) ?? tipsByParentId.set(t.parent, []).get(t.parent)!).push(t.id);
  }
  const presentIds = new Set<string>();
  for (const idx of tree.present) presentIds.add(asset.nodeIds[idx]);

  const ghostsUnder = (nodeId: string): RenderNode[] => {
    const out: RenderNode[] = [];
    for (const childId of nodeKidsByParent.get(nodeId) ?? []) {
      if (presentIds.has(childId)) continue; // already solid in the induced tree
      const n = asset.nodeById.get(childId);
      if (!n) continue;
      out.push({
        key: childId, kind: "node", label: n.common ?? n.sci, rank: n.rank,
        remaining: 0, showHidden: false, ghost: true, children: ghostsUnder(childId),
      });
    }
    for (const tipId of tipsByParentId.get(nodeId) ?? []) {
      if (tree.namedTips.has(tipId)) continue; // already named (solid)
      const t = asset.tipById.get(tipId);
      if (!t) continue;
      out.push({
        key: tipId, kind: "tip", label: t.common, sci: t.sci,
        remaining: 0, showHidden: false, ghost: true, children: [],
      });
    }
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return out;
  };
  return ghostsUnder;
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
