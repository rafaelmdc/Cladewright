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
  // "Awake" leaves have been shoved — by the cursor's wake or a collision (#57) — and glide
  // with damped velocity (no gravity), settling back into the calm drift once they slow.
  awake: boolean;
}

// Greens of the canopy + a couple of warm autumn strays.
const PALETTE = ["63,107,76", "92,122,82", "120,138,86", "150,116,66", "168,132,74"];

const GRAB_RADIUS = 22; // px slop around a leaf so it's easy to grab
const GRAVITY = 900; // px/s² on a flung leaf
const MAX_FLING = 2200; // clamp fling speed so a fast whip doesn't rocket off instantly
const REPEL_RADIUS = 78; // the cursor's "wake" reaches this far (#57)
const REPEL_ACCEL = 2600; // how hard the wake shoves a nearby leaf (px/s², scaled by nearness)
const SETTLE_SPEED = 7; // below this an awake leaf relaxes back into the gentle drift

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
    let pointerInside = false; // gates the cursor wake until we actually have a position

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
      awake: false,
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
        // The cursor's wake shoves any nearby drifting/awake leaf away from it (#57) — the
        // closer it is, the harder the push. A held or flung leaf ignores it.
        if (pointerInside && l !== held && !l.free) {
          const dx = l.x - px;
          const dy = l.y - py;
          const d = Math.hypot(dx, dy);
          if (d > 0.001 && d < REPEL_RADIUS) {
            const f = (1 - d / REPEL_RADIUS) * REPEL_ACCEL * dt;
            l.vx += (dx / d) * f;
            l.vy += (dy / d) * f;
            l.awake = true;
          }
        }

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
        } else if (l.awake) {
          // Shoved (by the wake or a collision): glide with damped velocity, NO gravity, so
          // the calm field isn't drained downward; relax back into drift once it slows.
          l.x += l.vx * dt;
          l.y += l.vy * dt;
          const damp = Math.pow(0.04, dt);
          l.vx *= damp;
          l.vy *= damp;
          l.rot += l.vrot * dt;
          l.vrot = l.vx * 0.02;
          if (Math.hypot(l.vx, l.vy) < SETTLE_SPEED) {
            l.awake = false;
            l.vx = 0;
            l.phase = Math.random() * Math.PI * 2; // rejoin the sway cleanly
          }
          if (l.y > h + 30 || l.x < -40 || l.x > w + 40) Object.assign(l, spawn(false));
        } else {
          // Gentle drift (the default mood).
          l.y += l.vy * dt;
          l.phase += l.sway * dt;
          l.x += Math.sin(l.phase) * l.drift * dt;
          l.rot += l.vrot * dt;
          if (l.y > h + 30) Object.assign(l, spawn(false));
        }
      }

      // Collisions: a MOVING leaf (held/flung/awake) bumps the ones it runs into and wakes
      // them, so a flick scatters the canopy like ragdolls. Drifting pairs pass through, so
      // the resting field stays calm. O(n²) over a small leaf count — cheap.
      for (let i = 0; i < leaves.length; i++) {
        const a = leaves[i];
        const aMoving = a === held || a.free || a.awake;
        for (let j = i + 1; j < leaves.length; j++) {
          const b = leaves[j];
          if (!aMoving && !(b === held || b.free || b.awake)) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.001;
          const min = (a.size + b.size) * 0.7;
          if (d >= min) continue;
          const nx = dx / d;
          const ny = dy / d;
          const overlap = min - d;
          const aPinned = a === held;
          const bPinned = b === held;
          // Separate along the contact normal (a pinned/held leaf doesn't get pushed).
          if (!aPinned && !bPinned) {
            a.x -= nx * overlap * 0.5;
            a.y -= ny * overlap * 0.5;
            b.x += nx * overlap * 0.5;
            b.y += ny * overlap * 0.5;
          } else if (aPinned) {
            b.x += nx * overlap;
            b.y += ny * overlap;
          } else {
            a.x -= nx * overlap;
            a.y -= ny * overlap;
          }
          // Trade a little push along the normal and wake both into the glide state.
          const kick = 60 + overlap * 6;
          if (!aPinned) {
            a.vx -= nx * kick;
            a.vy -= ny * kick;
            a.awake = a.awake || !a.free;
          }
          if (!bPinned) {
            b.vx += nx * kick;
            b.vy += ny * kick;
            b.awake = b.awake || !b.free;
          }
        }
      }

      for (const l of leaves) draw(l, l === held);
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
      pointAt(e); // track the cursor always, so its wake can push leaves even when not grabbing
      pointerInside = true;
    };

    const onLeave = () => {
      pointerInside = false;
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
    document.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.removeEventListener("mouseleave", onLeave);
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
