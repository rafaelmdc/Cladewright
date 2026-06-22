// LeafBackground — a calm canvas of leaves drifting down behind the page. Field-notebook
// mood, not a snow-globe: low count, low opacity, gentle sway + slow tumble. Honors
// prefers-reduced-motion (renders nothing), caps DPR, and cleans up its RAF loop.
//
// Easter egg (#39): you can GRAB a leaf and fling it. While held it springs to the cursor;
// on release it keeps that momentum, tumbles under gravity, and eventually drifts off and
// respawns. Pointer handling lives on window and ignores presses that land on real UI
// (buttons/links/inputs), so the fidget never steals a click — even though the canvas sits
// behind everything.

import { useEffect, useRef } from "react";

interface Leaf {
  x: number;
  y: number;
  size: number;
  vy: number; // fall speed (px/s) while drifting
  drift: number; // horizontal sway amplitude (px)
  phase: number; // sway phase
  sway: number; // sway frequency
  rot: number;
  vrot: number; // tumble speed (rad/s)
  color: number; // index into PALETTE
  alpha: number;
  // Easter-egg physics state. A "free" leaf has been flung and integrates real velocity
  // (vx/vy + gravity) instead of the gentle drift; it respawns once it leaves the canvas.
  free: boolean;
  vx: number;
}

// Greens of the canopy + a couple of warm autumn strays.
const PALETTE = ["63,107,76", "92,122,82", "120,138,86", "150,116,66", "168,132,74"];

const GRAB_RADIUS = 22; // px slop around a leaf so it's easy to grab
const GRAVITY = 900; // px/s² on a flung leaf
const MAX_FLING = 2200; // clamp fling speed so a fast whip doesn't rocket off instantly

/** A press on real UI (or inside it) should never grab a leaf. */
function onInteractiveEl(t: EventTarget | null): boolean {
  return !!(t instanceof Element && t.closest('button, a, input, textarea, select, label, [role="button"]'));
}

export function LeafBackground({ density = 26 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let w = 0;
    let h = 0;
    let raf = 0;
    let leaves: Leaf[] = [];
    // The currently grabbed leaf + the latest pointer position (canvas coords).
    let held: Leaf | null = null;
    let px = 0;
    let py = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (seeded: boolean): Leaf => ({
      x: Math.random() * w,
      y: seeded ? Math.random() * h : -24 - Math.random() * 60,
      size: 7 + Math.random() * 11,
      vy: 11 + Math.random() * 20,
      drift: 16 + Math.random() * 26,
      phase: Math.random() * Math.PI * 2,
      sway: 0.4 + Math.random() * 0.55,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 1.1,
      color: Math.floor(Math.random() * PALETTE.length),
      alpha: 0.1 + Math.random() * 0.22,
      free: false,
      vx: 0,
    });

    const draw = (l: Leaf, lifted: boolean) => {
      const s = l.size;
      // A grabbed/flung leaf reads a touch more solid, so the picked-up one stands out.
      const a = lifted ? Math.min(0.6, l.alpha + 0.22) : l.alpha;
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.rot);
      ctx.fillStyle = `rgba(${PALETTE[l.color]},${a})`;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(s * 0.72, -s * 0.15, 0, s);
      ctx.quadraticCurveTo(-s * 0.72, -s * 0.15, 0, -s);
      ctx.fill();
      ctx.strokeStyle = `rgba(${PALETTE[l.color]},${Math.min(0.5, a + 0.14)})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s);
      ctx.stroke();
      ctx.restore();
    };

    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);
      for (const l of leaves) {
        if (l === held) {
          // Spring to the cursor; velocity is derived from the move so a release flings it.
          const safe = Math.max(dt, 1 / 120);
          l.vx = Math.max(-MAX_FLING, Math.min(MAX_FLING, (px - l.x) / safe));
          l.vy = Math.max(-MAX_FLING, Math.min(MAX_FLING, (py - l.y) / safe));
          l.x = px;
          l.y = py;
          l.vrot = Math.max(-12, Math.min(12, l.vx * 0.01)); // spin with the swipe
        } else if (l.free) {
          // Flung: integrate momentum + gravity, with light air damping, until it exits.
          l.vy += GRAVITY * dt;
          const damp = Math.pow(0.6, dt);
          l.vx *= damp;
          l.vy *= damp;
          l.x += l.vx * dt;
          l.y += l.vy * dt;
          l.rot += l.vrot * dt;
          l.vrot *= Math.pow(0.5, dt);
          if (l.y > h + 40 || l.x < -40 || l.x > w + 40) Object.assign(l, spawn(false));
        } else {
          // Gentle drift (the default mood).
          l.y += l.vy * dt;
          l.phase += l.sway * dt;
          l.x += Math.sin(l.phase) * l.drift * dt;
          l.rot += l.vrot * dt;
          if (l.y > h + 30) Object.assign(l, spawn(false));
        }
        draw(l, l === held);
      }
      raf = requestAnimationFrame(frame);
    };

    const pointAt = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      px = e.clientX - r.left;
      py = e.clientY - r.top;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || onInteractiveEl(e.target)) return; // never fight the UI
      pointAt(e);
      // Grab the nearest leaf within reach (its own size, plus slop).
      let best: Leaf | null = null;
      let bestD = Infinity;
      for (const l of leaves) {
        const d = Math.hypot(l.x - px, l.y - py);
        const reach = l.size + GRAB_RADIUS;
        if (d < reach && d < bestD) {
          best = l;
          bestD = d;
        }
      }
      if (best) {
        held = best;
        best.free = false; // pin it to the cursor until release
      }
    };

    const onMove = (e: PointerEvent) => {
      if (held) pointAt(e);
    };

    const onUp = () => {
      if (held) {
        held.free = true; // keep its last velocity → it flies off and resumes drifting
        held = null;
      }
    };

    resize();
    leaves = Array.from({ length: density }, () => spawn(true));
    last = performance.now();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [density]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
