// Settings / tuning panel — a gear button (top-right) that opens a slide-in panel
// over the canvas. Holds the playtest dials from lib/game/settings.ts. Kept self-
// contained so it can be reused by Classic later.

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

import { DEFAULT_SETTINGS, type GameSettings } from "../lib/game/settings";

interface Props {
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
}

export function SettingsPanel({ settings, onChange }: Props) {
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

              <Toggle
                label="Infinite time"
                hint="Free play — the clock never runs out."
                checked={settings.infiniteTime}
                onChange={(v) => set("infiniteTime", v)}
              />

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
