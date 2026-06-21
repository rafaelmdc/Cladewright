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

import { cluster as d3cluster, hierarchy, type HierarchyPointNode } from "d3-hierarchy";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";

import type { InternedAsset } from "../lib/asset/types";
import { collapseTree, COLLAPSE_BUDGET } from "../lib/tree/collapse";
import { buildDisplayTree, type RenderNode } from "../lib/tree/display";
import type { RemainingTracker } from "../lib/game/remaining";
import type { TreeLayout } from "../lib/game/settings";
import type { InducedTree } from "../lib/tree/induced";
import { NodeCard } from "./NodeCard";

interface OpenCard {
  uid: number; // stable identity (a node can have several pinned cards over time)
  id: string;
  kind: "tip" | "node";
  px: number; // container-relative pixel anchor
  py: number;
  pinned: boolean; // click-pinned (persists, draggable) vs. transient hover peek
}

export interface TreeRendererProps {
  asset: InternedAsset;
  tree: InducedTree;
  tracker: RemainingTracker;
  /** bump to recompute when the (mutable) tree/tracker change in place */
  rev: number;
  /** canvas style — radial tree-of-life or rectangular phylogram */
  layout?: TreeLayout;
  /** show a species' scientific name (smaller) beneath its common name */
  showScientific?: boolean;
  /** transient "ping" on a freshly-named node; nonce re-fires the same node */
  pulse?: { key: string; nonce: number } | null;
}

const VIEW = 900; // svg viewBox is VIEW×VIEW, centered on (0,0)
const RADIUS = 360;
// Below this zoom the canvas is too small to fit secondary labels without them piling up,
// so we drop the "scientific" detail (tip scientific names + internal clade names) and
// keep only the leaf common names. Zoom back in to read the rest.
const LABEL_DETAIL_SCALE = 0.85;
const RECT = VIEW * 0.92; // rectangular layout fills a slightly inset square
// Minimum vertical gap (viewBox units) between phylogram leaf rows. Below ~one label's
// height the horizontal labels collide, so when there are many leaves we grow the canvas
// taller than the viewBox (pan/zoom to read) instead of packing the rows.
const RECT_MIN_ROW = 16;

interface Positioned {
  node: RenderNode;
  a: number; // angle (radians, already rotated so root opens upward); radial only
  r: number; // radius; radial only
  x: number; // cartesian, centered on origin
  y: number;
}

interface Link {
  key: string; // child's stable id — animation key
  d: string; // edge path
  d0: string; // collapsed-at-parent path (same command structure as `d`) for entry anim
}

const polar = (a: number, r: number): [number, number] => [r * Math.cos(a), r * Math.sin(a)];

/** A radial "elbow": the edge leaves the parent tangent to its radius circle (so the
 *  turn follows the arc instead of cutting a chord across the middle), sweeps to the
 *  child's angle at the parent's radius, then runs dead-straight radially out to the
 *  child. Built as one cubic bézier:
 *   - C1 is a tangent handle off the parent, its length scaled by the angular span — so
 *     wide branches bow along the circle rather than hooking inward;
 *   - C2 is the corner (child's angle, parent's radius), from which the curve arrives at
 *     the child purely radially.
 *  For an unbranched chain (parent and child share an angle) every control point lands
 *  on the same radial line, so the edge is a dead-straight spoke — no wobble on solo
 *  runs. Constant M…C… structure, so Framer Motion still interpolates growth smoothly. */
function radialLink(p: Positioned, c: Positioned): string {
  const [sx, sy] = polar(p.a, p.r);
  const [ex, ey] = polar(c.a, c.r);
  const da = c.a - p.a;
  const h = p.r * da * 0.55; // tangent handle length, signed by sweep direction
  const c1x = sx - Math.sin(p.a) * h;
  const c1y = sy + Math.cos(p.a) * h;
  // Corner control pulled a third of the way out radially, so the arc rounds smoothly
  // into the radial run instead of meeting it at a hard bend.
  const [c2x, c2y] = polar(c.a, p.r + (c.r - p.r) * 0.33);
  return `M${sx},${sy}C${c1x},${c1y} ${c2x},${c2y} ${ex},${ey}`;
}

/** Classic phylogram connector: a right-angle elbow — straight down the parent's depth
 *  column to the child's row, then straight out to the child. The dendrogram look. */
function rectLink(p: Positioned, c: Positioned): string {
  return `M${p.x},${p.y}L${p.x},${c.y}L${c.x},${c.y}`;
}

function layout(root: RenderNode, mode: TreeLayout): { nodes: Positioned[]; links: Link[] } {
  const h = hierarchy<RenderNode>(root, (d) => d.children);

  const pos = new Map<RenderNode, Positioned>();
  const nodes: Positioned[] = [];

  if (mode === "rectangular") {
    // d3 CLUSTER (dendrogram) on a square: d.x is the breadth (row), d.y is depth
    // (column). Cluster — not tree — pins every leaf to the deepest column, so all the
    // species labels line up at the right edge instead of scattering by lineage length
    // (which let shallow tips collide with deeper internal nodes). Map depth to the
    // horizontal screen axis so the tree reads left→right, and center the box.
    // Grow the breadth (vertical) axis so each leaf gets at least RECT_MIN_ROW of space;
    // for a small tree this is just RECT (unchanged), for a big one the tree gets tall.
    const breadth = Math.max(RECT, h.leaves().length * RECT_MIN_ROW);
    d3cluster<RenderNode>().size([breadth, RECT])(h);
    for (const d of h.descendants() as HierarchyPointNode<RenderNode>[]) {
      const p: Positioned = { node: d.data, a: 0, r: 0, x: d.y - RECT / 2, y: d.x - breadth / 2 };
      pos.set(d.data, p);
      nodes.push(p);
    }
  } else {
    // Cluster (not tree) so every leaf lands on the outer ring. With d3.tree, a shallow
    // clade like Monotremata (Platypus/Echidna) sat at a small radius — i.e. crammed into
    // the MIDDLE of the tree — because radius tracked graph depth. Cluster puts all tips
    // at RADIUS and lets internal nodes float inward, which is the cladogram look we want.
    d3cluster<RenderNode>().size([2 * Math.PI, RADIUS])(h);
    for (const d of h.descendants() as HierarchyPointNode<RenderNode>[]) {
      // d.x is angle (0..2π), d.y is radius; rotate -90° so the root opens upward.
      const a = d.x - Math.PI / 2;
      const [x, y] = polar(a, d.y);
      const p: Positioned = { node: d.data, a, r: d.y, x, y };
      pos.set(d.data, p);
      nodes.push(p);
    }
  }

  const links: Link[] = [];
  for (const d of h.descendants() as HierarchyPointNode<RenderNode>[]) {
    if (!d.parent) continue;
    const parent = pos.get(d.parent.data)!;
    const child = pos.get(d.data)!;
    const d_ = mode === "rectangular" ? rectLink(parent, child) : radialLink(parent, child);
    const d0 =
      mode === "rectangular"
        ? `M${parent.x},${parent.y}L${parent.x},${parent.y}L${parent.x},${parent.y}`
        : `M${parent.x},${parent.y}C${parent.x},${parent.y} ${parent.x},${parent.y} ${parent.x},${parent.y}`;
    links.push({ key: child.node.key, d: d_, d0 });
  }
  return { nodes, links };
}

export function TreeRenderer({
  asset,
  tree,
  tracker,
  rev,
  layout: mode = "radial",
  showScientific = true,
  pulse = null,
}: TreeRendererProps) {
  // Manual fold/unfold overrides on top of the automatic budget: `expanded` = wedges the
  // player opened; `collapsedKeys` = clades they folded shut. The Fit button clears both.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());

  const displayRoot = useMemo(
    () => buildDisplayTree(asset, tree, tracker),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asset, tree, tracker, rev],
  );
  const { nodes, links, rootKey } = useMemo(() => {
    const empty = { nodes: [] as Positioned[], links: [] as Link[], rootKey: null as string | null };
    if (!displayRoot) return empty;
    // Fold the densest subtrees into wedges so a few-hundred-tip tree stays legible.
    const { root } = collapseTree(displayRoot, COLLAPSE_BUDGET, expanded, collapsedKeys);
    return { ...layout(root, mode), rootKey: root.key };
  }, [displayRoot, mode, expanded, collapsedKeys]);

  // --- node cards (hover to peek, then pin from the card; many pinned cards allowed) ---
  const wrapRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const uidRef = useRef(0);
  const [cards, setCards] = useState<OpenCard[]>([]);

  const onlyPinned = (cs: OpenCard[]) => cs.filter((c) => c.pinned);

  function anchor(e: { clientX: number; clientY: number }): { px: number; py: number } {
    const r = wrapRef.current?.getBoundingClientRect();
    return { px: e.clientX - (r?.left ?? 0), py: e.clientY - (r?.top ?? 0) };
  }
  function scheduleTransientClose() {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setCards(onlyPinned), 160);
  }
  function onNodeEnter(node: RenderNode, e: { clientX: number; clientY: number }) {
    const at = anchor(e);
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(closeTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      const uid = ++uidRef.current;
      setCards((cs) => [
        ...onlyPinned(cs),
        { uid, id: node.key, kind: node.kind, px: at.px, py: at.py, pinned: false },
      ]);
    }, 280);
  }
  function onNodeLeave() {
    window.clearTimeout(hoverTimer.current);
    scheduleTransientClose();
  }
  // Click toggles a clade's fold state — cards are a hover-then-pin mechanic, so the click
  // is free for structure. A wedge opens; an open clade (not the root) folds shut; a tip
  // does nothing (hover it for its card).
  function onNodeClick(node: RenderNode) {
    window.clearTimeout(hoverTimer.current);
    const toggle = (drop: React.Dispatch<React.SetStateAction<Set<string>>>, add: React.Dispatch<React.SetStateAction<Set<string>>>) => {
      drop((s) => {
        if (!s.has(node.key)) return s;
        const n = new Set(s);
        n.delete(node.key);
        return n;
      });
      add((s) => new Set(s).add(node.key));
    };
    if (node.collapsed) {
      toggle(setCollapsedKeys, setExpanded); // wedge → open
    } else if (node.kind === "node" && node.key !== rootKey) {
      toggle(setExpanded, setCollapsedKeys); // open clade → fold shut
    } else {
      return; // tip: nothing to fold
    }
    setCards(onlyPinned); // a fold/unfold dismisses the transient hover peek
  }
  function pinCard(uid: number) {
    window.clearTimeout(closeTimer.current);
    setCards((cs) => cs.map((c) => (c.uid === uid ? { ...c, pinned: true } : c)));
  }
  function closeCard(uid: number) {
    setCards((cs) => cs.filter((c) => c.uid !== uid));
  }

  // --- pan / zoom ---
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  // Pan deltas arrive in CSS pixels but tx/ty live in viewBox user units; remember the
  // start position in both spaces so a drag converts correctly regardless of canvas size.
  const drag = useRef<{ cx: number; cy: number; tx: number; ty: number } | null>(null);

  /** User units per CSS pixel. The square viewBox fits via preserveAspectRatio "meet",
   *  so the uniform scale is set by the smaller rendered dimension. */
  function unitsPerPixel(): number {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return 1;
    return VIEW / Math.min(r.width, r.height);
  }

  function onWheel(e: React.WheelEvent) {
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => ({ ...v, scale: Math.min(6, Math.max(0.3, v.scale * factor)) }));
  }
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return; // left-drag only
    setCards(onlyPinned); // grabbing empty canvas dismisses the hover peek, keeps pins
    drag.current = { cx: e.clientX, cy: e.clientY, tx: view.tx, ty: view.ty };
    // Capture on the SVG itself (currentTarget) — a stable element. Capturing on e.target
    // (a child glyph/edge) could lose the pointer-up when that child re-rendered, leaving
    // a stuck drag that then panned on button-less moves.
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    // onPointerMove fires for ALL moves over the canvas, button or not. If the left
    // button isn't actually held, the drag has ended (possibly via a missed pointer-up) —
    // clear it so a moving cursor can never keep panning the tree off-screen.
    if ((e.buttons & 1) === 0) {
      drag.current = null;
      return;
    }
    // Snapshot the drag origin NOW. The setView updater below runs lazily (next render),
    // by which point a pointer-up may have nulled drag.current — reading it inside the
    // updater would throw and crash the canvas. Capture into locals first.
    const { cx, cy, tx: tx0, ty: ty0 } = drag.current;
    const f = unitsPerPixel();
    const dx = (e.clientX - cx) * f;
    const dy = (e.clientY - cy) * f;
    // Clamp so the tree can never be flung entirely off-canvas (a hard safety net on top
    // of the px→unit conversion). The bound grows with zoom so edges of a magnified tree
    // stay reachable, but the centre always stays within view.
    const limit = (VIEW / 2 + 60) * view.scale;
    const clamp = (n: number) => Math.max(-limit, Math.min(limit, n));
    setView((v) => ({ ...v, tx: clamp(tx0 + dx), ty: clamp(ty0 + dy) }));
  }
  function onPointerUp() {
    drag.current = null;
  }

  // Below this zoom we shed secondary labels; the culling pass needs to know so it doesn't
  // reserve space for text that won't render.
  const detail = view.scale >= LABEL_DETAIL_SCALE;
  // Map-style label decluttering: keep a label only if its box doesn't collide with one
  // already kept (higher-priority wins). Depends on zoom (which sets label size) but not
  // on pan — overlaps are translation-invariant.
  const shownLabels = useMemo(
    () => cullLabels(nodes, view.scale, showScientific, detail, pulse?.key ?? null),
    [nodes, view.scale, showScientific, detail, pulse?.key],
  );

  if (nodes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-clade-ink/40">
        <p className="text-sm">Name an organism to grow the tree…</p>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
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
              {links.map((l) => (
                <motion.path
                  key={`${mode}:${l.key}`}
                  initial={{ d: l.d0, opacity: 0 }}
                  animate={{ d: l.d, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                />
              ))}
            </AnimatePresence>
          </g>
          {/* nodes */}
          <AnimatePresence>
            {nodes.map((p) => (
              <motion.g
                key={`${mode}:${p.node.key}`}
                initial={{ x: 0, y: 0, opacity: 0 }}
                animate={{ x: p.x, y: p.y, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
                style={{ cursor: "pointer" }}
                onPointerEnter={(e) => onNodeEnter(p.node, e)}
                onPointerLeave={onNodeLeave}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onNodeClick(p.node)}
              >
                {pulse && pulse.key === p.node.key && (
                  <motion.circle
                    key={pulse.nonce}
                    className="fill-clade-accent"
                    initial={{ r: 3, opacity: 0.5 }}
                    animate={{ r: 24 / view.scale, opacity: 0 }}
                    transition={{ duration: 0.7, ease: "easeOut" }}
                  />
                )}
                <NodeGlyph
                  node={p.node}
                  showSci={showScientific}
                  scale={view.scale}
                  angle={mode === "radial" ? p.a : null}
                  detail={detail}
                  showLabel={shownLabels.has(p.node.key)}
                />
              </motion.g>
            ))}
          </AnimatePresence>
        </g>
      </svg>

      <AnimatePresence>
        {cards.map((c) => (
          <NodeCard
            key={c.uid}
            asset={asset}
            id={c.id}
            kind={c.kind}
            pinned={c.pinned}
            anchorX={c.px}
            anchorY={c.py}
            bounds={{
              w: wrapRef.current?.clientWidth ?? 0,
              h: wrapRef.current?.clientHeight ?? 0,
            }}
            dragRef={wrapRef}
            onPin={() => pinCard(c.uid)}
            onClose={() => closeCard(c.uid)}
            onHoverChange={
              c.pinned ? undefined : (over) => (over ? window.clearTimeout(closeTimer.current) : scheduleTransientClose())
            }
          />
        ))}
      </AnimatePresence>

      <button
        onClick={() => {
          setView({ scale: 1, tx: 0, ty: 0 });
          setExpanded(new Set());
          setCollapsedKeys(new Set());
        }}
        className="absolute bottom-4 right-4 rounded-lg border border-clade-ink/15 bg-white/70 px-3 py-1.5 text-xs text-clade-ink/70 backdrop-blur transition hover:border-clade-ink/40"
      >
        Fit
      </button>
    </div>
  );
}

/** Greedy label decluttering. Walk nodes in priority order and keep a label only if its
 *  (approximate) box doesn't overlap a label already kept. Returns the set of node keys
 *  whose label should render; the rest draw just their dot/wedge. Boxes are in viewBox
 *  units sized for the current zoom (labels counter-scale by k), so two near-identical
 *  spokes at the crowded top/bottom of a radial tree no longer stack their text. */
function cullLabels(
  nodes: Positioned[],
  scale: number,
  showSci: boolean,
  detail: boolean,
  pulseKey: string | null,
): Set<string> {
  const k = Math.min(1.6, 1 / scale);
  const FS = 9; // nominal font size in user units
  const CHAR = 0.52 * FS; // average glyph advance

  interface Box {
    key: string;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    prio: number;
  }
  const boxes: Box[] = [];
  for (const pos of nodes) {
    const n = pos.node;
    let chars = 0;
    let lines = 0;
    let prio = 1;
    if (n.collapsed) {
      chars = n.label.length + String(n.collapsedCount ?? "").length + 3;
      lines = 1;
      prio = 4; // wedges summarize many species — keep them
    } else if (n.kind === "tip") {
      chars = n.label.length;
      lines = 1;
      if (detail && showSci && n.sci && n.sci !== n.label) {
        chars = Math.max(chars, n.sci.length);
        lines = 2;
      }
      prio = 2;
    } else {
      if (detail) {
        chars = n.label.length;
        lines = 1;
      }
      if (n.showHidden) {
        chars = Math.max(chars, String(n.remaining).length + 7);
        lines += 1;
        prio = 3; // the "N hidden" hunt hint outranks a plain clade label
      }
    }
    if (chars === 0 || lines === 0) continue;

    const w = (chars * CHAR + 4) * k;
    const h = (lines === 1 ? 11 : 18) * k;
    const dir = Math.cos(pos.a) < 0 ? -1 : 1;
    const x0 = dir > 0 ? pos.x + 4 * k : pos.x - w;
    boxes.push({
      key: n.key,
      x0,
      x1: x0 + w,
      y0: pos.y - h * 0.55,
      y1: pos.y + h * 0.55,
      prio: n.key === pulseKey ? Infinity : prio,
    });
  }

  boxes.sort((a, b) => b.prio - a.prio || (a.key < b.key ? -1 : 1));
  const kept: Box[] = [];
  const show = new Set<string>();
  const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  for (const box of boxes) {
    if (box.prio === Infinity || !kept.some((q) => hits(box, q))) {
      kept.push(box);
      show.add(box.key);
    }
  }
  return show;
}

function NodeGlyph({
  node,
  showSci,
  scale,
  angle,
  detail,
  showLabel,
}: {
  node: RenderNode;
  showSci: boolean;
  scale: number;
  /** the node's screen angle (radians) for radial label orientation; null = rectangular */
  angle: number | null;
  /** zoomed in enough to show secondary (scientific / clade) labels */
  detail: boolean;
  /** survived collision culling — draw this node's label (the dot/wedge always draws) */
  showLabel: boolean;
}) {
  // Labels live in a group counter-scaled by 1/scale: as you zoom in, the pan/zoom
  // transform magnifies everything, so dividing the text (and its offsets) back out keeps
  // labels at a roughly constant screen size — zooming in to hunt nodes shrinks the type
  // relative to the tree instead of blowing it up. Capped so labels never get huge when
  // zoomed all the way out.
  const k = Math.min(1.6, 1 / scale);

  // Labels stay UPRIGHT (always readable) but are anchored toward the side of the circle
  // they sit on: a node on the left half extends its label leftward (anchor end), one on
  // the right extends rightward (anchor start). This keeps text away from the tree centre
  // and spreads crowded wedges, without the sideways/upside-down text that aligning labels
  // to the spoke produced. Rectangular mode keeps simple left-anchored labels.
  const flip = angle !== null && Math.cos(angle) < 0;
  const dir = flip ? -1 : 1;
  const anchor = flip ? "end" : "start";
  const labelTransform = `scale(${k})`;

  // Invisible, generous hit area so the tiny glyphs are easy to hover/click.
  const hit = <circle r={11} fill="transparent" />;

  // Collapsed clade → an outward-pointing wedge; click drills one level in. The label
  // ("Muridae · 142") names the family and how many species are folded inside.
  if (node.collapsed) {
    const tri = dir > 0 ? "M0,-5 L10,0 L0,5 Z" : "M0,-5 L-10,0 L0,5 Z";
    return (
      <>
        {hit}
        <g transform={labelTransform}>
          <path d={tri} className="fill-clade-accent/75" />
          {showLabel && (
            <text x={13 * dir} y={3} textAnchor={anchor} className="fill-clade-ink text-[9px] font-semibold">
              {node.label} · {node.collapsedCount}
            </text>
          )}
        </g>
      </>
    );
  }

  if (node.kind === "tip") {
    const withSci = detail && showSci && node.sci && node.sci !== node.label;
    return (
      <>
        {hit}
        <circle r={3.5} className="fill-clade-accent" />
        {showLabel && (
          <g transform={labelTransform}>
            <text
              x={6 * dir}
              y={withSci ? 1 : 3}
              textAnchor={anchor}
              className="fill-clade-ink text-[9px] font-semibold"
            >
              {node.label}
            </text>
            {withSci && (
              <text x={6 * dir} y={9} textAnchor={anchor} className="fill-clade-ink/45 text-[7px] italic">
                {node.sci}
              </text>
            )}
          </g>
        )}
      </>
    );
  }
  return (
    <>
      {hit}
      <circle r={2.5} className="fill-clade-ink/40" />
      {showLabel && (
        <g transform={labelTransform}>
          {detail && (
            <text x={6 * dir} y={-2} textAnchor={anchor} className="fill-clade-ink/60 text-[8px] italic">
              {node.label}
            </text>
          )}
          {node.showHidden && (
            <text x={6 * dir} y={9} textAnchor={anchor} className="fill-clade-accent text-[8px] font-medium">
              {node.remaining} hidden
            </text>
          )}
        </g>
      )}
    </>
  );
}
