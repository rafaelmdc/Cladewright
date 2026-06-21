// Settings / tuning panel — a gear button (top-right) that opens a slide-in panel
// over the canvas. Holds the playtest dials from lib/game/settings.ts. Kept self-
// contained so it can be reused by Classic later.

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

import { DEFAULT_SETTINGS, type GameSettings, type TreeLayout } from "../lib/game/settings";

interface Props {
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
  /** DEV CHEAT (remove before launch): auto-place N random organisms onto the tree. */
  onAutofill?: (n: number) => void;
}

export function SettingsPanel({ settings, onChange, onAutofill }: Props) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <>
      <button
        aria-label="Settings"
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
                <h2 className="text-lg font-semibold">Tuning</h2>
                <button
                  onClick={() => setOpen(false)}
                  className="text-clade-ink/50 hover:text-clade-ink"
                >
                  ✕
                </button>
              </div>

              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-clade-ink/40">Visual</p>
                <Segmented<TreeLayout>
                  label="Tree layout"
                  value={settings.treeLayout}
                  options={[
                    { value: "radial", label: "Radial" },
                    { value: "rectangular", label: "Phylogram" },
                  ]}
                  onChange={(v) => set("treeLayout", v)}
                />
                <div className="mt-4">
                  <Toggle
                    label="Scientific names"
                    hint="Show the binomial under each species' common name."
                    checked={settings.showScientific}
                    onChange={(v) => set("showScientific", v)}
                  />
                </div>
              </div>

              <div className="border-t border-clade-ink/10 pt-4">
                <p className="mb-3 text-xs uppercase tracking-wide text-clade-ink/40">Pool</p>
                <Toggle
                  label="Living species only"
                  hint="Exclude extinct species — they don't count and the remaining-counts switch to living-only totals."
                  checked={settings.extantOnly}
                  onChange={(v) => set("extantOnly", v)}
                />
              </div>

              <div className="border-t border-clade-ink/10 pt-4">
                <p className="mb-3 text-xs uppercase tracking-wide text-clade-ink/40">Time</p>
                <Toggle
                  label="Infinite time"
                  hint="Free play — the clock never runs out."
                  checked={settings.infiniteTime}
                  onChange={(v) => set("infiniteTime", v)}
                />
                <div className="mt-4">
                  <Slider
                    label="Start time"
                    unit="s"
                    min={10}
                    max={300}
                    step={5}
                    value={settings.startSeconds}
                    disabled={settings.infiniteTime}
                    onChange={(v) => set("startSeconds", v)}
                  />
                </div>
              </div>

              <div className="border-t border-clade-ink/10 pt-4">
                <p className="mb-3 text-xs uppercase tracking-wide text-clade-ink/40">
                  Time per organism
                </p>
                <Slider
                  label="New placement (base)"
                  unit="s"
                  min={0}
                  max={30}
                  step={1}
                  value={settings.timePerNew}
                  disabled={settings.infiniteTime}
                  onChange={(v) => set("timePerNew", v)}
                />
                <Slider
                  label="Novelty bonus (max)"
                  hint="Extra time for opening a brand-new branch."
                  unit="s"
                  min={0}
                  max={30}
                  step={1}
                  value={settings.noveltyBonus}
                  disabled={settings.infiniteTime}
                  onChange={(v) => set("noveltyBonus", v)}
                />
                <Slider
                  label="Refinement"
                  hint="Naming a species under a clade you already have."
                  unit="s"
                  min={0}
                  max={15}
                  step={1}
                  value={settings.timePerRefinement}
                  disabled={settings.infiniteTime}
                  onChange={(v) => set("timePerRefinement", v)}
                />
              </div>

              {/* DEV CHEAT — remove this whole block before launch. */}
              {onAutofill && (
                <div className="border-t border-dashed border-clade-ink/20 pt-4">
                  <p className="mb-1 text-xs uppercase tracking-wide text-clade-ink/40">
                    Cheat · dev
                  </p>
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

              <button
                onClick={() => onChange({ ...DEFAULT_SETTINGS })}
                className="mt-auto rounded-lg border border-clade-ink/15 px-3 py-2 text-sm text-clade-ink/60 transition hover:border-clade-ink/40"
              >
                Reset to defaults
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1.5 flex rounded-lg border border-clade-ink/15 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
              value === o.value
                ? "bg-clade-accent text-white"
                : "text-clade-ink/60 hover:text-clade-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span>
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-clade-ink/45">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
          checked ? "bg-clade-accent" : "bg-clade-ink/20"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </label>
  );
}

function Slider({
  label,
  hint,
  unit,
  min,
  max,
  step,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className={`mb-4 ${disabled ? "opacity-40" : ""}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-sm text-clade-ink/60">
          {value}
          {unit}
        </span>
      </div>
      {hint && <span className="block text-xs text-clade-ink/45">{hint}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-clade-accent"
      />
    </div>
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
