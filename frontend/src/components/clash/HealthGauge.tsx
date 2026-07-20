// The Clade Clash health gauge — shared by solo (CladeClash) and the realtime duel
// (ClashVersus), because two copies of this drifted apart once already.
//
// The old bar was a rounded 2.5px track with a width transition and a small "−12" in mono.
// Losing health is the emotional core of a duel, so it now does three things instead:
//   • a GHOST segment holds the health you just lost, in red, and collapses a beat later —
//     so you see what the miss cost rather than inferring it from a bar that already moved;
//   • the number COUNTS down instead of snapping;
//   • the gauge takes the hit — one short shake, and the damage reads in the display face.
//
// Visually it's an inked gauge, not a Material progress bar: square ends, a 2px ink rule and
// a hatched fill, so it belongs to the same notebook as the rest of the app. Damage colours
// are semantic tokens (--hp-bad / --hp-warn, defined per theme in index.css), deliberately
// off the accent hue and warm-biased — Tailwind's red-500/amber-500 read as neon on cream.
//
// Everything moving is gated on prefers-reduced-motion, matching Marathon's effects.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

export function HealthGauge({
  label,
  hp,
  max = 100,
  dmg = 0,
  reverse,
  highlight,
}: {
  label: string;
  hp: number;
  /** Full health, so solo (HP_MAX) and the server-driven duel (0..100) share one component. */
  max?: number;
  /** Health lost this round — drives the ghost segment, the shake and the readout. */
  dmg?: number;
  /** Mirror the fill and label for the opponent's side, so the bars face each other. */
  reverse?: boolean;
  highlight?: boolean;
}) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const ghostPct = Math.max(0, Math.min(100, ((hp + dmg) / max) * 100));
  const fill =
    hp / max <= 0.25
      ? "bg-[color:var(--hp-bad)]"
      : hp / max <= 0.55
        ? "bg-[color:var(--hp-warn)]"
        : "bg-clade-accent";

  return (
    <div className="flex-1">
      <div
        className={`flex items-baseline justify-between font-mono text-[10px] uppercase tracking-widest ${
          reverse ? "flex-row-reverse" : ""
        }`}
      >
        <span className={`truncate ${highlight ? "text-clade-accent" : "text-clade-ink/50"}`}>
          {label}
        </span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          <AnimatePresence>
            {dmg > 0 && (
              <motion.span
                key={`${dmg}-${hp}`}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.8 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 22 }}
                className="font-hand text-2xl font-bold leading-none text-[color:var(--hp-bad)]"
              >
                −{dmg}
              </motion.span>
            )}
          </AnimatePresence>
          <CountUp value={Math.max(0, Math.round(hp))} />
        </span>
      </div>

      <motion.div
        animate={dmg > 0 && !reduce ? { x: [0, -3, 3, -2, 0] } : { x: 0 }}
        transition={{ duration: 0.32 }}
        className="relative mt-1 h-4 overflow-hidden rounded-[3px] border-2 border-clade-ink/20 bg-clade-ink/[0.04]"
      >
        <div
          className={`absolute inset-y-0 ${reverse ? "right-0" : "left-0"} bg-[color:var(--hp-bad)]/30 transition-[width] duration-700 ease-out`}
          style={{ width: `${ghostPct}%` }}
        />
        <motion.div
          className={`absolute inset-y-0 ${reverse ? "right-0" : "left-0"} ${fill}`}
          style={{
            width: `${pct}%`,
            backgroundImage:
              "repeating-linear-gradient(90deg, transparent 0 5px, rgb(0 0 0 / 8%) 5px 6px)",
          }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
        />
      </motion.div>
    </div>
  );
}

/** Health ticks down rather than snapping — a number in motion reads as damage taken. */
function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    if (reduce || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const dur = 420;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3); // ease-out cubic: fast, then settles
      setShown(Math.round(a + (value - a) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce]);

  return <span className="font-bold tabular-nums text-clade-ink/70">{shown}</span>;
}
