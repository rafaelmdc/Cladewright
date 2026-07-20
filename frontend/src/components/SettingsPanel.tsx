// In-game gear — a button (top-right) that opens a slide-in panel over the canvas. Holds
// only VISUAL prefs (layout, scientific names, leaves, fade): gameplay settings are chosen in
// the lobby and frozen for the run, so they never appear here. Visual prefs are global and
// persist across runs. Rendered from the per-game schema's visual fields. See
// docs/lobby-and-config.md.

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

import { SettingsFields } from "./controls/SettingControls";
import { visualFields } from "../lib/game/schema";
import { formatMultiplier } from "../lib/game/multipliers";
import type { GameSettings } from "../lib/game/settings";

interface Props {
  mode: string;
  settings: GameSettings;
  /** Apply + persist a visual-pref change (the only thing tunable mid-run). */
  onChange: (next: GameSettings) => void;
  /** This run's score multiplier (modifiers × eased settings, #101) — shown read-only, since
   *  gameplay is frozen at the lobby and can't change here. 1.0 = a default run. */
  multiplier?: number;
  /** Setting keys the active modifiers have made irrelevant (modifierEffects().hidden) — these
   *  dials are dropped from the gear. */
  hidden?: Set<keyof GameSettings>;
  /** DEV-ONLY CHEAT: auto-place N random organisms onto the tree. Rendered only under
   *  `import.meta.env.DEV` (see below) — never present in a production build. */
  onAutofill?: (n: number) => void;
}

export function SettingsPanel({ mode, settings, onChange, multiplier = 1, hidden, onAutofill }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        aria-label="Display settings"
        data-tour="settings"
        onClick={() => setOpen((o) => !o)}
        className="pointer-events-auto absolute right-4 top-4 z-30 grid h-9 w-9 place-items-center rounded-lg border border-clade-ink/15 bg-white/70 text-clade-ink/70 backdrop-blur transition hover:border-clade-ink/40"
      >
        <GearIcon />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="absolute inset-0 z-30 bg-black/10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              className="absolute right-0 top-0 z-40 flex h-full w-80 max-w-[85vw] flex-col gap-5 overflow-y-auto border-l border-clade-ink/10 bg-clade-bg/95 p-5 shadow-xl backdrop-blur"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Display</h2>
                <button onClick={() => setOpen(false)} className="text-clade-ink/50 hover:text-clade-ink">
                  ✕
                </button>
              </div>

              {/* Read-only score multiplier. Gameplay + modifiers (and so the multiplier) are
                  fixed at the lobby — only visual prefs are tunable here, and they never move it. */}
              <div className="-mt-2">
                <span
                  className={`font-mono text-[11px] uppercase tracking-wide ${
                    multiplier === 1
                      ? "text-clade-ink/45"
                      : multiplier > 1
                        ? "text-clade-accent"
                        : "text-clade-ink/55"
                  }`}
                >
                  {multiplier === 1 ? "● Default run" : `● ${formatMultiplier(multiplier)} run`}
                </span>
                <p className="mt-1 font-mono text-[10px] text-clade-ink/40">
                  Every run is on the board, ranked by score × multiplier. Set packs, difficulty,
                  gameplay &amp; modifiers before the run, from the game menu.
                </p>
              </div>

              <SettingsFields fields={visualFields(mode, hidden)} settings={settings} onChange={onChange} />

              {/* DEV CHEAT — dev-only. import.meta.env.DEV is true under the Vite dev server and
                  false in the production build (`vite build`), so this is compiled out of prod. */}
              {import.meta.env.DEV && onAutofill && (
                <div className="mt-auto border-t border-dashed border-clade-ink/20 pt-4">
                  <p className="mb-1 text-xs uppercase tracking-wide text-clade-ink/40">Cheat · dev</p>
                  <p className="mb-3 text-xs text-clade-ink/45">
                    Auto-place random organisms so you don't have to type a tree by hand.
                  </p>
                  <div className="flex gap-2">
                    {[25, 50, 100, 300].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => onAutofill(n)}
                        className="flex-1 rounded-md border border-clade-ink/15 px-2 py-1.5 font-mono text-sm text-clade-ink/70 transition hover:border-clade-accent hover:text-clade-accent"
                      >
                        +{n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
