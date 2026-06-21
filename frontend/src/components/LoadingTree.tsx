// LoadingTree — the loading screen for asset / daily loads. A tree-of-life that *sprouts*
// (radial branches drawing outward, leaf-dots popping at the tips, looping) under a line of
// hand-curated, biology-nerdy flavour text that fades in and out. Reusable across every
// game's load. Honours prefers-reduced-motion (static tree + one quip, no loop). See #26.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

// Curated phylogenetics in-jokes — meant to actually land for a biologist, not generic
// "loading…" filler. Keep this list witty; trim anything that smells like an AI listicle.
const QUIPS = [
  "Rooting the tree (don't tell the botanists)…",
  "Asking the cladists to settle down…",
  "Sorting the beetles — there are, inexplicably, so many…",
  "Waiting for the sponges to make up their minds…",
  "Convincing the platypus to pick a class…",
  "A hyena is neither cat nor dog. Anyway…",
  "Bribing the molecular clock…",
  "Untangling some convergent evolution…",
  "Counting millipede legs (never actually a thousand)…",
  "Apologising to the tardigrades…",
  "Reconciling a few gene trees…",
];

const SPOKES = 7;
const R = 36; // branch length in viewBox units

export function LoadingTree({ label = "Growing the tree" }: { label?: string }) {
  const reduce = useReducedMotion();
  // Random first quip so a quick load doesn't always flash the same line.
  const [qi, setQi] = useState(() => Math.floor(Math.random() * QUIPS.length));

  useEffect(() => {
    if (reduce) return; // reduced motion → a single, static quip
    const id = window.setInterval(() => setQi((i) => (i + 1) % QUIPS.length), 2600);
    return () => window.clearInterval(id);
  }, [reduce]);

  const spokes = Array.from({ length: SPOKES }, (_, i) => {
    const a = (i / SPOKES) * Math.PI * 2 - Math.PI / 2; // open upward
    return { i, x: Math.cos(a) * R, y: Math.sin(a) * R };
  });

  return (
    <div className="flex h-full min-h-[70vh] w-full flex-col items-center justify-center gap-5 text-clade-accent">
      <svg viewBox="-50 -50 100 100" className="h-28 w-28" aria-hidden>
        <circle r={3.2} className="fill-clade-ink/70" />
        {spokes.map((s) => (
          <g key={s.i}>
            <motion.line
              x1={0}
              y1={0}
              x2={s.x}
              y2={s.y}
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0.25 }}
              animate={
                reduce
                  ? { pathLength: 1, opacity: 0.9 }
                  : { pathLength: [0, 1, 1, 0], opacity: [0.25, 1, 1, 0.25] }
              }
              transition={
                reduce
                  ? undefined
                  : {
                      duration: 2.6,
                      times: [0, 0.4, 0.75, 1],
                      repeat: Infinity,
                      delay: s.i * 0.12,
                      ease: "easeInOut",
                    }
              }
            />
            <motion.circle
              cx={s.x}
              cy={s.y}
              r={2.6}
              className="fill-clade-accent"
              initial={{ scale: 0 }}
              animate={reduce ? { scale: 1 } : { scale: [0, 1, 1, 0] }}
              transition={
                reduce
                  ? undefined
                  : {
                      duration: 2.6,
                      times: [0, 0.45, 0.75, 1],
                      repeat: Infinity,
                      delay: s.i * 0.12,
                      ease: "easeOut",
                    }
              }
            />
          </g>
        ))}
      </svg>

      <div className="flex h-6 items-center px-6 text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={qi}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.4 }}
            className="font-hand text-xl text-clade-ink/55"
          >
            {QUIPS[qi]}
          </motion.p>
        </AnimatePresence>
      </div>

      <span className="font-mono text-[10px] uppercase tracking-widest text-clade-ink/35">
        {label}
      </span>
    </div>
  );
}
