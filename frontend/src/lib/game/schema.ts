// Declarative, per-game settings schema — the single description the lobby (and the in-game
// gear, for the visual subset) render from, instead of hardcoding controls. A new game ships
// its schema here; no bespoke UI. Score-easing settings resolve to a multiplier server-side
// (apps/scores/multipliers.py, mirrored in lib/game/multipliers.ts for the lobby preview).
// See docs/lobby-and-config.md.

import type { GameSettings } from "./settings";

export type SettingKind = "toggle" | "slider" | "segmented";

export interface SettingField {
  key: keyof GameSettings;
  kind: SettingKind;
  label: string;
  hint?: string;
  group: string; // section header in the panel / lobby
  /** Visual-only — stays reachable in the in-game gear and never affects score/rank. */
  visual?: boolean;
  // slider
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  // segmented
  options?: { value: string; label: string }[];
  /** Greyed out when true — e.g. time dials under infinite time. */
  disabledWhen?: (s: GameSettings) => boolean;
}

const underInfiniteTime = (s: GameSettings) => s.infiniteTime;

/** Time Attack (marathon) player controls, grouped as they appear in the panel / lobby. */
const MARATHON_FIELDS: SettingField[] = [
  { key: "treeLayout", kind: "segmented", label: "Tree layout", group: "Visual", visual: true,
    options: [{ value: "radial", label: "Radial" }, { value: "rectangular", label: "Phylogram" }] },
  { key: "showScientific", kind: "toggle", label: "Scientific names", group: "Visual", visual: true,
    hint: "Show the binomial under each species' common name." },
  { key: "fallingLeaves", kind: "toggle", label: "Falling leaves", group: "Visual", visual: true,
    hint: "Ambient leaves behind the board, flung about by combo explosions." },
  { key: "flashFadeSeconds", kind: "slider", label: "Notification fade", group: "Visual", visual: true,
    unit: "s", min: 0.5, max: 5, step: 0.5,
    hint: "How long a '+seconds' / 'no match' card lingers before fading." },

  { key: "extantOnly", kind: "toggle", label: "Living species only", group: "Pool",
    hint: "Exclude extinct species. Few are flagged extinct in the source data, so limited effect for now." },

  { key: "infiniteTime", kind: "toggle", label: "Infinite time", group: "Time",
    hint: "Free play — the clock never runs out." },
  { key: "startSeconds", kind: "slider", label: "Start time", group: "Time",
    unit: "s", min: 10, max: 300, step: 5, disabledWhen: underInfiniteTime },

  { key: "timePerNew", kind: "slider", label: "New placement (base)", group: "Time per organism",
    unit: "s", min: 0, max: 30, step: 1, disabledWhen: underInfiniteTime },
  { key: "noveltyBonus", kind: "slider", label: "Novelty bonus (max)", group: "Time per organism",
    unit: "s", min: 0, max: 30, step: 1, disabledWhen: underInfiniteTime,
    hint: "Extra time for opening a brand-new branch." },
  { key: "timePerRefinement", kind: "slider", label: "Refinement", group: "Time per organism",
    unit: "s", min: 0, max: 15, step: 1, disabledWhen: underInfiniteTime,
    hint: "Naming a species under a clade you already have." },

  { key: "comboWindowSeconds", kind: "slider", label: "Combo window", group: "Combos",
    unit: "s", min: 2, max: 12, step: 0.5, disabledWhen: underInfiniteTime,
    hint: "Max gap between placements to keep a streak alive." },
  { key: "comboTimeMultiplier", kind: "slider", label: "Combo time bonus", group: "Combos",
    unit: "×", min: 0, max: 4, step: 0.5, disabledWhen: underInfiniteTime,
    hint: "Bonus seconds per combo step (× the combo level)." },
];

/** Per game-mode. A new game adds its entry; the lobby renders whatever's here. */
export const SETTINGS_SCHEMA: Record<string, SettingField[]> = {
  marathon_free: MARATHON_FIELDS,
  marathon_daily: MARATHON_FIELDS,
};

export function schemaFor(mode: string): SettingField[] {
  return SETTINGS_SCHEMA[mode] ?? SETTINGS_SCHEMA.marathon_free;
}

/** Visual-only fields (the in-game gear keeps these) vs gameplay fields (the lobby owns). */
export function visualFields(mode: string): SettingField[] {
  return schemaFor(mode).filter((f) => f.visual);
}
export function gameplayFields(mode: string): SettingField[] {
  return schemaFor(mode).filter((f) => !f.visual);
}
