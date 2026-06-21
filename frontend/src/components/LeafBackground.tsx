// LeafBackground — a calm canvas of leaves drifting down behind the page. Field-notebook
// mood, not a snow-globe: low count, low opacity, gentle sway + slow tumble. Honors
// prefers-reduced-motion (renders nothing), caps DPR, and cleans up its RAF loop.

import { useEffect, useRef } from "react";

interface Leaf {
  x: number;
  y: number;
  size: number;
  vy: number; // fall speed (px/s)
  drift: number; // horizontal sway amplitude (px)
  phase: number; // sway phase
  sway: number; // sway frequency
  rot: number;
  vrot: number; // tumble speed (rad/s)
  color: number; // index into PALETTE
  alpha: number;
}

// Greens of the canopy + a couple of warm autumn strays.
const PALETTE = ["63,107,76", "92,122,82", "120,138,86", "150,116,66", "168,132,74"];

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
    });

    const draw = (l: Leaf) => {
      const s = l.size;
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.rot);
      ctx.fillStyle = `rgba(${PALETTE[l.color]},${l.alpha})`;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(s * 0.72, -s * 0.15, 0, s);
      ctx.quadraticCurveTo(-s * 0.72, -s * 0.15, 0, -s);
      ctx.fill();
      ctx.strokeStyle = `rgba(${PALETTE[l.color]},${Math.min(0.5, l.alpha + 0.14)})`;
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
        l.y += l.vy * dt;
        l.phase += l.sway * dt;
        l.x += Math.sin(l.phase) * l.drift * dt;
        l.rot += l.vrot * dt;
        if (l.y > h + 30) Object.assign(l, spawn(false));
        draw(l);
      }
      raf = requestAnimationFrame(frame);
    };

    resize();
    leaves = Array.from({ length: density }, () => spawn(true));
    last = performance.now();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
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
