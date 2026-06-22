// Combo juice for Time Attack (#60). Mixes two layers so it reads big without overwhelming:
//   • the canopy — a low-opacity warm-gold edge vignette that builds with the combo, plus a
//     rare leaf burst at each milestone (the "let it rip" moment); and
//   • the readout — a small hand-lettered "×N" tag by the timer that charges green→gold.
// (The third, on-tree layer is the node bloom in TreeRenderer.) Global effects stay faint and
// eased; bright things are either tiny (the tag) or rare (milestones). Honors reduced-motion.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const ACCENT: [number, number, number] = [63, 107, 76];
const GOLD: [number, number, number] = [199, 154, 58];

/** Heat 0..1 → the colour the combo charges toward (forest green → warm gold). */
function heatColor(t: number): string {
  const k = Math.min(Math.max(t, 0), 1);
  const c = ACCENT.map((a, i) => Math.round(a + (GOLD[i] - a) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function leafPath(s: number): string {
  return `M0,${-s} Q${s * 0.72},${-s * 0.15} 0,${s} Q${-s * 0.72},${-s * 0.15} 0,${-s} Z`;
}

export interface ComboFxProps {
  /** current combo length (0/1 = no active combo) */
  combo: number;
  /** heat 0..1 driving the vignette + colour */
  intensity: number;
  /** bumps each time the combo grows — replays the tag bounce */
  comboNonce: number;
  /** bumps when a milestone (×5, ×10, …) is hit — fires the leaf burst */
  milestoneNonce: number;
  /** a just-completed clade to celebrate, or null */
  cladeEvent: { name: string; bonus: number; nonce: number } | null;
}

export function ComboFx({ combo, intensity, comboNonce, milestoneNonce, cladeEvent }: ComboFxProps) {
  const reduced = useReducedMotion();
  const active = combo >= 2;
  const color = heatColor(intensity);

  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
      {/* Canopy vignette — felt, not watched: capped low and eased. */}
      {!reduced && (
        <motion.div
          aria-hidden
          className="absolute inset-0"
          animate={{ opacity: active ? 1 : 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={{
            background: `radial-gradient(120% 120% at 50% 50%, transparent 55%, rgba(${GOLD[0]},${GOLD[1]},${GOLD[2]},${0.13 * intensity}) 100%)`,
          }}
        />
      )}

      {/* Combo readout, tucked under the timer (top-left). */}
      <AnimatePresence>
        {active && (
          <motion.div
            key="combo-tag"
            className="absolute left-6 top-44 leading-none sm:top-32"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <motion.div
              key={comboNonce}
              initial={{ scale: reduced ? 1 : 1.35 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 16 }}
              className="font-hand text-5xl font-bold"
              style={{ color }}
            >
              ×{combo}
            </motion.div>
            <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color, opacity: 0.7 }}>
              combo
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Milestone burst — the rare big moment that links the readout to the canopy. */}
      {!reduced && milestoneNonce > 0 && <MilestoneBurst key={milestoneNonce} />}

      {/* Clade-complete banner. */}
      <AnimatePresence>
        {cladeEvent && (
          <motion.div
            key={cladeEvent.nonce}
            className="absolute left-1/2 top-1/3 -translate-x-1/2 whitespace-nowrap rounded-full border-2 border-clade-accent/40 bg-clade-paper/95 px-5 py-2 text-center shadow-lg backdrop-blur"
            initial={{ opacity: 0, scale: reduced ? 1 : 0.7, y: 0 }}
            animate={{ opacity: 1, scale: 1, y: reduced ? 0 : -24 }}
            exit={{ opacity: 0, y: -48 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <span className="font-hand text-3xl font-bold text-clade-ink">
              ✓ {cladeEvent.name} complete
            </span>
            <span className="ml-2 font-hand text-2xl font-bold" style={{ color: heatColor(0.8) }}>
              +{cladeEvent.bonus}s
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A one-shot ring of leaves flung from screen centre. Mounted fresh per milestone (keyed
 *  upstream), so it just plays its entrance once. */
function MilestoneBurst() {
  const leaves = 14;
  return (
    <div className="absolute left-1/2 top-1/2">
      {Array.from({ length: leaves }).map((_, i) => {
        const ang = (i / leaves) * Math.PI * 2;
        const dist = 150 + (i % 3) * 40;
        return (
          <motion.svg
            key={i}
            width={20}
            height={20}
            viewBox="-10 -10 20 20"
            className="absolute"
            initial={{ x: 0, y: 0, scale: 0.2, opacity: 0.85, rotate: 0 }}
            animate={{
              x: Math.cos(ang) * dist,
              y: Math.sin(ang) * dist,
              scale: 1,
              opacity: 0,
              rotate: i % 2 ? 140 : -140,
            }}
            transition={{ duration: 1, ease: "easeOut" }}
          >
            <path d={leafPath(8)} fill={heatColor(0.85)} />
          </motion.svg>
        );
      })}
    </div>
  );
}
