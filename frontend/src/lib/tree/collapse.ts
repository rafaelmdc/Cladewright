// Adaptive clade collapse — the "too many nodes" fix. A tree of a few hundred placed
// species can't show every leaf legibly (the labels merge into a solid band), so we cap
// how many glyphs render: the densest subtrees fold into a single expandable WEDGE
// ("Muridae · 142") while the backbone stays fully drawn. Pure level-of-detail — it's a
// no-op on small trees, and the underlying game state is untouched.
//
// Algorithm: a frontier expansion (OneZoom/treemap-style LOD). Start with the root as one
// glyph and repeatedly "open" the frontier node with the most species beneath it — i.e.
// drill down the biggest branches first — until opening any further node would push the
// rendered-glyph count past the budget. Whatever's still on the frontier with children
// underneath becomes a wedge. Nodes the player explicitly expanded (and their ancestors)
// are always opened, even past the budget.

import type { RenderNode } from "./display";

/** Target number of leaf/wedge glyphs on the canvas. Above this, fold the densest
 *  subtrees. Tuned for legibility of a radial ring; collision culling thins the rest. */
export const COLLAPSE_BUDGET = 90;

/** Count placed species (tips) beneath every node; memoized into `into`. */
function countLeaves(n: RenderNode, into: Map<RenderNode, number>): number {
  if (n.children.length === 0) {
    const c = n.kind === "tip" ? 1 : 0;
    into.set(n, c);
    return c;
  }
  let sum = 0;
  for (const c of n.children) sum += countLeaves(c, into);
  into.set(n, sum);
  return sum;
}

/**
 * Fold dense subtrees into wedges so at most ~`budget` frontier glyphs render. Returns a
 * NEW RenderNode tree (the input is not mutated); collapsed nodes get `collapsed:true` and
 * `collapsedCount`. `expanded` holds node keys the player drilled into — those branches
 * stay open regardless of budget.
 */
export function collapseTree(
  root: RenderNode,
  budget: number,
  expanded: ReadonlySet<string>,
  forceClosed: ReadonlySet<string> = new Set(),
): { root: RenderNode; collapsedAny: boolean } {
  const leaves = new Map<RenderNode, number>();
  countLeaves(root, leaves);

  // `open` = nodes whose children we draw. Everything else with children → a wedge.
  const open = new Set<RenderNode>();
  const blocked = new Set<RenderNode>(); // too big to open within remaining budget
  const frontier: RenderNode[] = [root];
  const expandable = (n: RenderNode) => n.children.length > 0;
  let rendered = 1; // glyphs currently on the frontier

  // Greedy budget expansion: always drill the biggest unopened branch that still fits.
  for (;;) {
    let best: RenderNode | null = null;
    let bestLeaves = -1;
    for (const n of frontier) {
      // forceClosed = a clade the player manually folded; never auto-open it.
      if (!expandable(n) || open.has(n) || blocked.has(n) || forceClosed.has(n.key)) continue;
      const lc = leaves.get(n) ?? 0;
      if (lc > bestLeaves) {
        bestLeaves = lc;
        best = n;
      }
    }
    if (!best) break;
    const delta = best.children.length - 1; // opening replaces 1 glyph with its children
    // Always open the root (open.size === 0) so we never render the whole tree as one
    // wedge; after that, refuse opens that blow the budget and try a smaller branch.
    if (open.size > 0 && rendered + delta > budget) {
      blocked.add(best);
      continue;
    }
    open.add(best);
    rendered += delta;
    const i = frontier.indexOf(best);
    frontier.splice(i, 1, ...best.children);
  }

  // Honor explicit expansions: open the named node and every ancestor up to the root, so
  // a clicked wedge always reveals its next level even when the budget is spent.
  if (expanded.size > 0) {
    const byKey = new Map<string, RenderNode>();
    const parentOf = new Map<RenderNode, RenderNode | null>();
    (function walk(n: RenderNode, p: RenderNode | null) {
      byKey.set(n.key, n);
      parentOf.set(n, p);
      for (const c of n.children) walk(c, n);
    })(root, null);
    for (const key of expanded) {
      let n: RenderNode | null | undefined = byKey.get(key);
      while (n) {
        open.add(n);
        n = parentOf.get(n) ?? null;
      }
    }
  }

  let collapsedAny = false;
  const rebuild = (n: RenderNode): RenderNode => {
    if (n.children.length === 0) return n; // tip / already a leaf
    // The display root is never folded — that would hide the whole tree behind one wedge.
    if (n === root || open.has(n)) return { ...n, children: n.children.map(rebuild) };
    collapsedAny = true;
    return {
      ...n,
      children: [],
      collapsed: true,
      collapsedCount: leaves.get(n) ?? 0,
      showHidden: false, // the wedge's own "N · clade" label replaces the hidden badge
    };
  };

  return { root: rebuild(root), collapsedAny };
}
