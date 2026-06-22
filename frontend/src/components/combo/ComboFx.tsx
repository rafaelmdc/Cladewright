// Combo juice for Time Attack (#60) — the screen-space layer. (The explosion lives on the
// placed node, in TreeRenderer.) Here we keep two restrained things:
//   • the canopy — a low-opacity warm-gold edge vignette that builds with the combo; and
//   • the readout — a hand-lettered "×N" tag by the timer whose colour fill DRAINS top→bottom
//     over the keep-alive window, so you can see at a glance how long the combo has left.
// Plus a clade-complete toast. Global effects stay faint/eased; honors reduced-motion.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const ACCENT: [number, number, number] = [63, 107, 76];
const GOLD: [number, number, number] = [199, 154, 58];

/** Heat 0..1 → the colour the combo charges toward (forest green → warm gold). */
function heatColor(t: number): string {
  const k = Math.min(Math.max(t, 0), 1);
  const c = ACCENT.map((a, i) => Math.round(a + (GOLD[i] - a) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export interface ComboFxProps {
  /** current combo length (0/1 = no active combo) */
  combo: number;
  /** heat 0..1 driving the vignette + colour */
  intensity: number;
  /** bumps each time the combo grows — restarts the drain + tag bounce */
  comboNonce: number;
  /** the combo keep-alive window in ms — the drain runs over exactly this long */
  windowMs: number;
  /** a just-completed clade to celebrate, or null */
  cladeEvent: { name: string; bonus: number; nonce: number } | null;
}

export function ComboFx({ combo, intensity, comboNonce, windowMs, cladeEvent }: ComboFxProps) {
  const reduced = useReducedMotion();
  const active = combo >= 2;

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

      {/* Combo readout, tucked under the timer (top-left), with a draining fill that doubles
          as the combo's countdown. */}
      <AnimatePresence>
        {active && (
          <motion.div
            key="combo-tag"
            className="absolute left-6 top-44 leading-none sm:top-32"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <ComboTag
              combo={combo}
              intensity={intensity}
              comboNonce={comboNonce}
              windowMs={windowMs}
              reduced={!!reduced}
            />
            <span
              className="block font-mono text-[10px] uppercase tracking-widest"
              style={{ color: heatColor(intensity), opacity: 0.7 }}
            >
              combo
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clade-complete toast — floats up and fades (auto-cleared upstream). */}
      <AnimatePresence>
        {cladeEvent && (
          <motion.div
            key={cladeEvent.nonce}
            className="absolute left-1/2 top-[30%] -translate-x-1/2 whitespace-nowrap rounded-full border-2 border-clade-accent/40 bg-clade-paper/95 px-5 py-2 text-center shadow-lg backdrop-blur"
            initial={{ opacity: 0, scale: reduced ? 1 : 0.7, y: 0 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : -28 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            <span className="font-hand text-3xl font-bold text-clade-ink">
              ✓ {cladeEvent.name} complete
            </span>
            <span className="ml-2 font-hand text-2xl font-bold" style={{ color: heatColor(0.85) }}>
              +{cladeEvent.bonus}s
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The "×N" tag. A faded base glyph sits under a colour-filled copy whose visible height
 *  shrinks from 100%→0% over the keep-alive window (anchored at the bottom, so the fill
 *  drains downward) — a glanceable countdown for the combo. Restarts on each placement. */
function ComboTag({
  combo,
  intensity,
  comboNonce,
  windowMs,
  reduced,
}: {
  combo: number;
  intensity: number;
  comboNonce: number;
  windowMs: number;
  reduced: boolean;
}) {
  const color = heatColor(intensity);
  const label = `×${combo}`;
  return (
    <motion.div
      key={comboNonce}
      className="relative inline-block"
      initial={{ scale: reduced ? 1 : 1.3 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 16 }}
    >
      {/* faded base */}
      <span className="block font-hand text-5xl font-bold" style={{ color, opacity: 0.22 }}>
        {label}
      </span>
      {/* draining colour fill (bottom-anchored: as height shrinks, the fill recedes downward) */}
      <motion.div
        key={comboNonce}
        className="absolute inset-x-0 bottom-0 overflow-hidden"
        initial={{ height: "100%" }}
        animate={{ height: reduced ? "100%" : "0%" }}
        transition={{ duration: windowMs / 1000, ease: "linear" }}
      >
        <span
          className="absolute inset-x-0 bottom-0 block font-hand text-5xl font-bold"
          style={{ color }}
        >
          {label}
        </span>
      </motion.div>
    </motion.div>
  );
}
