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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  /** "Scientific only" difficulty: show species by their Latin name (no common name) */
  scientificPrimary?: boolean;
  /** transient "ping" on a freshly-named node; nonce re-fires the same node */
  pulse?: { key: string; nonce: number } | null;
  /** combo length at the moment of the ping — drives the on-node explosion (#60). */
  pulseCombo?: number;
  /** game-over: reveal the un-named species beneath each "N hidden" label as faded ghosts */
  reveal?: boolean;
  /** "No Wikipedia" modifier (#123): suppress the hover NodeCards entirely (name from memory). */
  noWiki?: boolean;
}

const PULSE_ACCENT: [number, number, number] = [63, 107, 76];
const PULSE_GOLD: [number, number, number] = [199, 154, 58];
const EXPLODE_AT = 3; // combo at which the node explosion kicks in (it grows from here)
const LONG_PRESS_MS = 450; // touch: hold this long on a clade to fold/unfold it (#133)
const TAP_MOVE_CANCEL = 12; // px of finger travel that turns a tap/long-press into a pan/drag

/** Heat 0..1 → forest-green charging toward warm gold. */
function pulseColor(t: number): string {
  const k = Math.min(Math.max(t, 0), 1);
  const c = PULSE_ACCENT.map((a, i) => Math.round(a + (PULSE_GOLD[i] - a) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** A single leaf outline centred on the origin (same silhouette as the background leaves). */
function leafPath(s: number): string {
  return `M0,${-s} Q${s * 0.72},${-s * 0.15} 0,${s} Q${-s * 0.72},${-s * 0.15} 0,${-s} Z`;
}

/** The freshly-placed-node ping — and, from ×3 up, the combo explosion, which fires right at
 *  the placed node (not screen centre) and gets bigger every step (#60). Keyed by nonce
 *  upstream so it remounts/replays on every placement. */
function NodePulse({ combo, scale }: { combo: number; scale: number }) {
  const lvl = Math.max(0, combo - (EXPLODE_AT - 1)); // 0 below ×3, 1 at ×3, 2 at ×4, …
  const grow = Math.min(lvl, 10);
  const heat = Math.min(combo / 12, 1);
  const color = pulseColor(heat);
  const base = 24 / scale;
  const ring = base * (1 + grow * 0.22);
  const leaves = lvl > 0 ? Math.min(4 + (lvl - 1) * 2, 22) : 0; // grows each combo step
  const ls = (4.5 / scale) * (1 + grow * 0.07);
  const spread = base * (1.1 + grow * 0.42);
  return (
    <>
      <motion.circle
        fill={color}
        initial={{ r: 3, opacity: 0.55 }}
        animate={{ r: ring, opacity: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
      {Array.from({ length: leaves }).map((_, i) => {
        const ang = (i / leaves) * Math.PI * 2;
        const R = spread * (0.8 + (i % 3) * 0.18); // a little radial variety → organic
        return (
          <motion.path
            key={i}
            d={leafPath(ls)}
            fill={color}
            initial={{ x: 0, y: 0, scale: 0.2, opacity: 0.85, rotate: 0 }}
            animate={{
              x: Math.cos(ang) * R,
              y: Math.sin(ang) * R,
              scale: 1,
              opacity: 0,
              rotate: i % 2 ? 90 : -90,
            }}
            transition={{ duration: 0.85, ease: "easeOut" }}
          />
        );
      })}
    </>
  );
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
  ghost?: boolean; // child is a revealed (un-named) ghost — drawn faint
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
    links.push({ key: child.node.key, d: d_, d0, ghost: child.node.ghost });
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
  scientificPrimary = false,
  pulse = null,
  pulseCombo = 0,
  reveal = false,
  noWiki = false,
}: TreeRendererProps) {
  // Manual fold/unfold overrides on top of the automatic budget: `expanded` = wedges the
  // player opened; `collapsedKeys` = clades they folded shut. The Fit button clears both.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());

  const displayRoot = useMemo(
    () => buildDisplayTree(asset, tree, tracker, reveal),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asset, tree, tracker, rev, reveal],
  );
  const { nodes, links, rootKey, ext } = useMemo(() => {
    const empty = {
      nodes: [] as Positioned[], links: [] as Link[], rootKey: null as string | null,
      ext: { x: VIEW / 2, y: VIEW / 2 },
    };
    if (!displayRoot) return empty;
    // Fold the densest subtrees into wedges so a few-hundred-tip tree stays legible.
    const { root } = collapseTree(displayRoot, COLLAPSE_BUDGET, expanded, collapsedKeys);
    const laid = layout(root, mode);
    // Content half-extent (from the centred origin) — the rectangular layout grows taller
    // than the viewBox, so fit + pan clamping must follow the real content, not VIEW.
    let ex = 0;
    let ey = 0;
    for (const p of laid.nodes) {
      ex = Math.max(ex, Math.abs(p.x));
      ey = Math.max(ey, Math.abs(p.y));
    }
    return { ...laid, rootKey: root.key, ext: { x: ex, y: ey } };
  }, [displayRoot, mode, expanded, collapsedKeys]);

  // --- node cards (hover to peek, then pin from the card; many pinned cards allowed) ---
  const wrapRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const uidRef = useRef(0);
  const [cards, setCards] = useState<OpenCard[]>([]);
  // Touch tap/long-press bookkeeping (#133): a short tap opens a node's card, a long-press
  // folds the clade. lastTouch suppresses the synthetic click that follows a touch tap.
  const pressRef = useRef<{ key: string; x: number; y: number; fired: boolean; timer: number } | null>(null);
  const lastTouchRef = useRef(false);

  const onlyPinned = (cs: OpenCard[]) => cs.filter((c) => c.pinned);

  function anchor(e: { clientX: number; clientY: number }): { px: number; py: number } {
    const r = wrapRef.current?.getBoundingClientRect();
    return { px: e.clientX - (r?.left ?? 0), py: e.clientY - (r?.top ?? 0) };
  }
  function scheduleTransientClose() {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setCards(onlyPinned), 160);
  }
  function onNodeEnter(node: RenderNode, e: React.PointerEvent) {
    if (noWiki) return; // "No Wikipedia" modifier (#123): no hover cards at all.
    if (e.pointerType === "touch") return; // touch has no hover — a tap opens the card instead.
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
  // Fold/unfold a clade: a wedge opens, an open clade (not the root) folds shut, a tip does
  // nothing. On desktop this is a click (cards are a separate hover-then-pin mechanic); on
  // touch it's a long-press (a tap opens the card instead).
  function foldNode(node: RenderNode) {
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
  function onNodeClick(node: RenderNode) {
    if (lastTouchRef.current) return; // touch routes through tap/long-press, not the click
    foldNode(node);
  }

  // Touch: toggle this node's pinned card (there's no hover to open a transient one).
  function toggleCardAt(node: RenderNode, e: { clientX: number; clientY: number }) {
    if (noWiki) return;
    const at = anchor(e);
    setCards((cs) => {
      const open = cs.find((c) => c.id === node.key && c.pinned);
      if (open) return cs.filter((c) => c.uid !== open.uid); // tap again to dismiss
      const uid = ++uidRef.current;
      return [...onlyPinned(cs), { uid, id: node.key, kind: node.kind, px: at.px, py: at.py, pinned: true }];
    });
  }
  function onNodePointerDown(node: RenderNode, e: React.PointerEvent) {
    e.stopPropagation(); // a node press must not also start a canvas pan/pinch
    lastTouchRef.current = e.pointerType === "touch";
    if (e.pointerType !== "touch") return;
    window.clearTimeout(pressRef.current?.timer);
    const timer = window.setTimeout(() => {
      if (pressRef.current) pressRef.current.fired = true;
      foldNode(node); // held long enough → fold/unfold
    }, LONG_PRESS_MS);
    pressRef.current = { key: node.key, x: e.clientX, y: e.clientY, fired: false, timer };
  }
  function onNodePointerMove(e: React.PointerEvent) {
    const pr = pressRef.current;
    if (!pr) return;
    if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > TAP_MOVE_CANCEL) {
      window.clearTimeout(pr.timer); // slid off → it's a drag, not a tap/long-press
      pressRef.current = null;
    }
  }
  function onNodePointerUp(node: RenderNode, e: React.PointerEvent) {
    const pr = pressRef.current;
    if (e.pointerType === "touch" && pr && pr.key === node.key) {
      window.clearTimeout(pr.timer);
      if (!pr.fired) toggleCardAt(node, e); // short tap → open/close the card
      pressRef.current = null;
    }
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
  // Latest view in a ref so the pointer handlers read current pan/zoom without re-binding.
  const viewRef = useRef(view);
  viewRef.current = view;
  // Pan deltas arrive in CSS pixels but tx/ty live in viewBox user units; remember the
  // start position in both spaces so a drag converts correctly regardless of canvas size.
  const drag = useRef<{ cx: number; cy: number; tx: number; ty: number } | null>(null);
  // Active canvas pointers (id → last client pos). One = pan; two = pinch-zoom. Touch has no
  // wheel, so pinch is the ONLY way to zoom in on mobile (#133).
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; mx: number; my: number } | null>(null);

  /** Frame the whole tree: zoom so the larger content axis fits the viewBox (only ever
   *  zooms OUT — a small tree stays at 1×), centred. This is what keeps a tall phylogram
   *  on-canvas instead of running off the top and bottom. */
  const fit = useCallback(() => {
    const halfMax = Math.max(ext.x, ext.y, 1);
    // Only zoom OUT, and only when the content actually overflows the viewBox — so a radial
    // tree (always within RADIUS) and the empty canvas stay at 1×, unchanged.
    const scale = halfMax > VIEW / 2 ? Math.max(0.3, VIEW / 2 / halfMax) : 1;
    setView({ scale, tx: 0, ty: 0 });
  }, [ext.x, ext.y]);

  // Auto-fit when the LAYOUT changes (radial⇄phylogram is an explicit reflow), and when the
  // game-over ghost reveal flips (the tree suddenly gains its missed branches — frame the
  // whole thing so the player can then pan around it). Not on every placement, so growth
  // stays stable and never yanks the user's pan/zoom mid-game.
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reveal]);

  /** User units per CSS pixel. The square viewBox fits via preserveAspectRatio "meet",
   *  so the uniform scale is set by the smaller rendered dimension. */
  function unitsPerPixel(): number {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return 1;
    return VIEW / Math.min(r.width, r.height);
  }

  // Zoom must be a NON-passive native listener: React's onWheel is passive, so its
  // preventDefault is ignored and the browser runs its default wheel action — which for
  // ctrl+wheel / trackpad pinch is to zoom the WHOLE PAGE (#31, #45). We listen on WINDOW,
  // not the SVG, for two reasons:
  //   * the SVG doesn't exist on a fresh (empty) tree, so an svg-scoped listener with []
  //     deps could never attach;
  //   * a zoom GESTURE (ctrl+wheel / pinch) over the HUD, search bar, or settings — not
  //     just over the canvas — must still be caught, or the browser zooms the page and the
  //     overlays scale + shift. The UI must stay fixed in both scale AND position (#45).
  // So: a zoom gesture anywhere zooms the canvas (UI untouched); a plain wheel only zooms
  // when actually over the tree, leaving scrollable UI (the settings panel) free to scroll.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const svg = svgRef.current;
      const overCanvas = !!svg && svg.contains(e.target as Node);
      if (!e.ctrlKey && !overCanvas) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setView((v) => ({ ...v, scale: Math.min(6, Math.max(0.3, v.scale * factor)) }));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);
  /** Distance + midpoint (client px) of the two active pinch pointers. */
  function twoPointerState(): { dist: number; mx: number; my: number } {
    const [a, b] = [...pointers.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return; // primary button / touch / pen only
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Capture on the SVG itself (currentTarget) — a stable element. Capturing on e.target
    // (a child glyph/edge) could lose the pointer-up when that child re-rendered, leaving
    // a stuck drag that then panned on button-less moves.
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 1) {
      setCards(onlyPinned); // grabbing empty canvas dismisses the hover peek, keeps pins
      drag.current = { cx: e.clientX, cy: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
    } else if (pointers.current.size === 2) {
      drag.current = null; // second finger down → switch from pan to pinch
      pinch.current = twoPointerState();
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const tracked = pointers.current.get(e.pointerId);
    if (tracked) {
      tracked.x = e.clientX;
      tracked.y = e.clientY;
    }
    // Two fingers → pinch-zoom about the finger midpoint, plus two-finger pan.
    if (pointers.current.size >= 2 && pinch.current) {
      const cur = twoPointerState();
      const f = unitsPerPixel();
      const r = svgRef.current?.getBoundingClientRect();
      const cx = (r?.left ?? 0) + (r?.width ?? 0) / 2;
      const cy = (r?.top ?? 0) + (r?.height ?? 0) / 2;
      // Midpoint in viewBox units (the square viewBox is centred on the svg centre).
      const vx = (cur.mx - cx) * f;
      const vy = (cur.my - cy) * f;
      const panX = (cur.mx - pinch.current.mx) * f;
      const panY = (cur.my - pinch.current.my) * f;
      const rawRatio = pinch.current.dist > 0 ? cur.dist / pinch.current.dist : 1;
      setView((v) => {
        const scale = Math.min(6, Math.max(0.3, v.scale * rawRatio));
        const ratio = scale / v.scale; // effective ratio after clamping
        // Hold the point under the fingers fixed while scaling, then apply the pan.
        return {
          scale,
          tx: vx * (1 - ratio) + v.tx * ratio + panX,
          ty: vy * (1 - ratio) + v.ty * ratio + panY,
        };
      });
      pinch.current = cur;
      return;
    }
    // One finger / mouse → pan.
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
    // Clamp so the tree can never be flung entirely off-canvas. The bound follows the
    // ACTUAL content half-extent (per axis), so every leaf of a tall phylogram stays
    // reachable by panning — not just the slice that fits the viewBox.
    const limX = (Math.max(VIEW / 2, ext.x) + 60) * viewRef.current.scale;
    const limY = (Math.max(VIEW / 2, ext.y) + 60) * viewRef.current.scale;
    setView((v) => ({
      ...v,
      tx: Math.max(-limX, Math.min(limX, tx0 + dx)),
      ty: Math.max(-limY, Math.min(limY, ty0 + dy)),
    }));
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      // One finger left after a pinch — resume panning from where it sits, so it doesn't jump.
      const [only] = pointers.current.values();
      drag.current = { cx: only.x, cy: only.y, tx: viewRef.current.tx, ty: viewRef.current.ty };
    } else if (pointers.current.size === 0) {
      drag.current = null;
    }
  }

  // Below this zoom we shed secondary labels; the culling pass needs to know so it doesn't
  // reserve space for text that won't render.
  const detail = view.scale >= LABEL_DETAIL_SCALE;
  // Map-style label decluttering: keep a label only if its box doesn't collide with one
  // already kept (higher-priority wins). Depends on zoom (which sets label size) but not
  // on pan — overlaps are translation-invariant.
  const shownLabels = useMemo(
    () => cullLabels(nodes, view.scale, showScientific, detail, pulse?.key ?? null, scientificPrimary),
    [nodes, view.scale, showScientific, detail, pulse?.key, scientificPrimary],
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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {/* edges */}
          <g stroke="currentColor" className="text-clade-ink/20" strokeWidth={1.2} fill="none">
            <AnimatePresence>
              {links.map((l) => (
                <motion.path
                  key={`${mode}:${l.key}`}
                  initial={{ d: l.d0, opacity: 0 }}
                  animate={{ d: l.d, opacity: l.ghost ? 0.28 : 1 }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                  strokeDasharray={l.ghost ? "3 4" : undefined}
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
                animate={{ x: p.x, y: p.y, opacity: p.node.ghost ? 0.4 : 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
                style={{ cursor: "pointer" }}
                onPointerEnter={(e) => onNodeEnter(p.node, e)}
                onPointerLeave={onNodeLeave}
                onPointerDown={(e) => onNodePointerDown(p.node, e)}
                onPointerMove={onNodePointerMove}
                onPointerUp={(e) => onNodePointerUp(p.node, e)}
                onClick={() => onNodeClick(p.node)}
              >
                {pulse && pulse.key === p.node.key && (
                  <NodePulse key={pulse.nonce} combo={pulseCombo} scale={view.scale} />
                )}
                <NodeGlyph
                  node={p.node}
                  showSci={showScientific}
                  scientificPrimary={scientificPrimary}
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
          setExpanded(new Set());
          setCollapsedKeys(new Set());
          fit();
        }}
        // Lifts above the mobile bottom-docked search input; corner-anchored on desktop.
        className="absolute bottom-20 right-4 rounded-lg border border-clade-ink/15 bg-white/70 px-3 py-1.5 text-xs text-clade-ink/70 backdrop-blur transition hover:border-clade-ink/40 sm:bottom-4"
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
  scientificPrimary: boolean,
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
      if (scientificPrimary) {
        chars = (n.sci || n.label).length; // Latin only
        lines = 1;
      } else {
        chars = n.label.length;
        lines = 1;
        if (detail && showSci && n.sci && n.sci !== n.label) {
          chars = Math.max(chars, n.sci.length);
          lines = 2;
        }
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
  scientificPrimary,
  scale,
  angle,
  detail,
  showLabel,
}: {
  node: RenderNode;
  showSci: boolean;
  /** "Scientific only" difficulty: tips show their Latin name, no common name */
  scientificPrimary: boolean;
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
    // Scientific-only difficulty: the Latin binomial IS the label (italic), no common name.
    if (scientificPrimary) {
      return (
        <>
          {hit}
          <circle r={3.5} className="fill-clade-accent" />
          {showLabel && (
            <g transform={labelTransform}>
              <text x={6 * dir} y={3} textAnchor={anchor} className="fill-clade-ink text-[9px] font-semibold italic">
                {node.sci || node.label}
              </text>
            </g>
          )}
        </>
      );
    }
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
