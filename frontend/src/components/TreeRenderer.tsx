// TreeRenderer — the shared tree-of-life view used by both games.
//
//   - renders only the INDUCED tree (named tips + their MRCAs), never the backbone
//   - radial layout via d3-hierarchy
//   - LAYOUT STABILITY IS A FEATURE: every node animates to its new position
//     (Framer Motion) keyed by stable id, so growth never teleports
//   - node types: found tip (bold), clade node, "N hidden" sister label
//   - pan / zoom / fit
//
// See docs/marathon-design.md#layout-stability and docs/architecture.md.

import { hierarchy, tree as d3tree, type HierarchyPointNode } from "d3-hierarchy";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";

import type { InternedAsset } from "../lib/asset/types";
import { buildDisplayTree, type RenderNode } from "../lib/tree/display";
import type { RemainingTracker } from "../lib/game/remaining";
import type { InducedTree } from "../lib/tree/induced";

export interface TreeRendererProps {
  asset: InternedAsset;
  tree: InducedTree;
  tracker: RemainingTracker;
  /** bump to recompute when the (mutable) tree/tracker change in place */
  rev: number;
}

const VIEW = 900; // svg viewBox is VIEW×VIEW, centered on (0,0)
const RADIUS = 360;

interface Positioned {
  node: RenderNode;
  x: number; // cartesian, centered on origin
  y: number;
}

function layout(root: RenderNode): { nodes: Positioned[]; links: [Positioned, Positioned][] } {
  const h = hierarchy<RenderNode>(root, (d) => d.children);
  d3tree<RenderNode>().size([2 * Math.PI, RADIUS])(h);

  const pos = new Map<RenderNode, Positioned>();
  const nodes: Positioned[] = [];
  for (const d of h.descendants() as HierarchyPointNode<RenderNode>[]) {
    // d.x is angle (0..2π), d.y is radius; rotate -90° so the root opens upward.
    const a = d.x - Math.PI / 2;
    const p: Positioned = { node: d.data, x: d.y * Math.cos(a), y: d.y * Math.sin(a) };
    pos.set(d.data, p);
    nodes.push(p);
  }
  const links: [Positioned, Positioned][] = [];
  for (const d of h.descendants() as HierarchyPointNode<RenderNode>[]) {
    if (d.parent) links.push([pos.get(d.parent.data)!, pos.get(d.data)!]);
  }
  return { nodes, links };
}

export function TreeRenderer({ asset, tree, tracker, rev }: TreeRendererProps) {
  const { nodes, links } = useMemo(() => {
    const root = buildDisplayTree(asset, tree, tracker);
    return root ? layout(root) : { nodes: [], links: [] as [Positioned, Positioned][] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, tree, tracker, rev]);

  // --- pan / zoom ---
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  function onWheel(e: React.WheelEvent) {
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => ({ ...v, scale: Math.min(6, Math.max(0.3, v.scale * factor)) }));
  }
  function onPointerDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX - view.tx, y: e.clientY - view.ty };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    setView((v) => ({ ...v, tx: e.clientX - drag.current!.x, ty: e.clientY - drag.current!.y }));
  }
  function onPointerUp() {
    drag.current = null;
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-clade-ink/40">
        <p className="text-sm">Name an organism to grow the tree…</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <svg
        viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}
        className="h-full w-full touch-none select-none"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {/* edges */}
          <g stroke="currentColor" className="text-clade-ink/20" strokeWidth={1.2} fill="none">
            <AnimatePresence>
              {links.map(([a, b]) => (
                <motion.line
                  key={b.node.key}
                  initial={{ x1: a.x, y1: a.y, x2: a.x, y2: a.y, opacity: 0 }}
                  animate={{ x1: a.x, y1: a.y, x2: b.x, y2: b.y, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                />
              ))}
            </AnimatePresence>
          </g>
          {/* nodes */}
          <AnimatePresence>
            {nodes.map((p) => (
              <motion.g
                key={p.node.key}
                initial={{ x: 0, y: 0, opacity: 0 }}
                animate={{ x: p.x, y: p.y, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
              >
                <NodeGlyph node={p.node} />
              </motion.g>
            ))}
          </AnimatePresence>
        </g>
      </svg>

      <button
        onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}
        className="absolute bottom-4 right-4 rounded-lg border border-clade-ink/15 bg-white/70 px-3 py-1.5 text-xs text-clade-ink/70 backdrop-blur transition hover:border-clade-ink/40"
      >
        Fit
      </button>
    </div>
  );
}

function NodeGlyph({ node }: { node: RenderNode }) {
  if (node.kind === "tip") {
    return (
      <>
        <circle r={3.5} className="fill-clade-accent" />
        <text x={6} y={3} className="fill-clade-ink text-[9px] font-semibold">
          {node.label}
        </text>
      </>
    );
  }
  return (
    <>
      <circle r={2.5} className="fill-clade-ink/40" />
      <text x={6} y={-2} className="fill-clade-ink/60 text-[8px] italic">
        {node.label}
      </text>
      {node.showHidden && (
        <text x={6} y={9} className="fill-clade-accent text-[8px] font-medium">
          {node.remaining} hidden
        </text>
      )}
    </>
  );
}
