// Client mirror of the server's score-multiplier resolution (#101), for the lobby's LIVE
// preview: as you toggle modifiers / change settings, show the multiplier the run will score
// at. The server re-resolves authoritatively at submit (apps/scores/multipliers.py) — this is
// presentation only, fed by the same rules the server hands back from /api/scores/modifiers/.

import type { GameSettings } from "./settings";

const API = import.meta.env.VITE_API_BASE_SCORES ?? "/api/scores";

/** One opt-in gameplay modifier (a GameModifier row). */
export interface ModifierDef {
  key: string;
  label: string;
  blurb: string;
  multiplier: number;
  incompatible_with: string[];
}

/** A per-setting derate rule (mirrors apps/scores/multipliers.py). */
export type SettingRule =
  | { kind: "bool"; easing_value: unknown; multiplier: number }
  | { kind: "linear"; default: number; per_unit: number; floor: number };

/** The /modifiers payload: the game's modifiers + the setting-derate rules + its defaults. */
export interface ModifierInfo {
  modifiers: ModifierDef[];
  setting_multipliers: Record<string, SettingRule>;
  defaults: Partial<GameSettings>;
}

const EMPTY: ModifierInfo = { modifiers: [], setting_multipliers: {}, defaults: {} };

/** Fetch a game's modifiers + multiplier rules. Returns an empty set if the backend is down,
 *  so the lobby still works (no modifiers, 1.0×). */
export async function fetchModifiers(mode?: string): Promise<ModifierInfo> {
  try {
    const q = mode ? `?mode=${encodeURIComponent(mode)}` : "";
    const res = await fetch(`${API}/modifiers/${q}`);
    if (!res.ok) return EMPTY;
    const d = await res.json();
    return {
      modifiers: (d.modifiers ?? []) as ModifierDef[],
      setting_multipliers: (d.setting_multipliers ?? {}) as Record<string, SettingRule>,
      defaults: (d.defaults ?? {}) as Partial<GameSettings>,
    };
  } catch {
    return EMPTY;
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** One setting's derate from its rule + the run's value (mirrors `_setting_factor`). 1.0 when
 *  it doesn't apply, so a malformed rule can only fail to derate — never inflate. */
export function settingFactor(rule: SettingRule, value: unknown): number {
  if (rule.kind === "bool") return value === rule.easing_value ? rule.multiplier : 1;
  if (rule.kind === "linear") {
    if (typeof value !== "number") return 1;
    return clamp(1 + rule.per_unit * (value - rule.default), rule.floor, 1);
  }
  return 1;
}

/** Product of every score-easing setting's derate (only deviations contribute). */
export function settingsMultiplier(settings: GameSettings, rules: Record<string, SettingRule>): number {
  let m = 1;
  const s = settings as unknown as Record<string, unknown>;
  for (const [key, rule] of Object.entries(rules)) {
    if (key in s) m *= settingFactor(rule, s[key]);
  }
  return m;
}

/** The active modifier keys that conflict (per their `incompatible_with`) — the lobby greys
 *  these out; a config carrying a conflicting pair is rejected by the server. */
export function conflictingModifiers(active: string[], defs: ModifierDef[]): Set<string> {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const chosen = new Set(active);
  const bad = new Set<string>();
  for (const k of active) {
    for (const other of byKey.get(k)?.incompatible_with ?? []) {
      if (chosen.has(other)) {
        bad.add(k);
        bad.add(other);
      }
    }
  }
  return bad;
}

/** Full preview multiplier: ∏ active-modifier factors × ∏ setting derates. Conflicting
 *  modifiers are skipped from the product (the lobby blocks selecting them anyway). */
export function previewMultiplier(
  active: string[],
  settings: GameSettings,
  info: ModifierInfo,
): number {
  const byKey = new Map(info.modifiers.map((d) => [d.key, d]));
  const bad = conflictingModifiers(active, info.modifiers);
  let m = 1;
  for (const k of active) {
    if (bad.has(k)) continue;
    m *= byKey.get(k)?.multiplier ?? 1;
  }
  return m * settingsMultiplier(settings, info.setting_multipliers);
}

/** "1.5×" / "0.75×" — a compact label for a multiplier. */
export function formatMultiplier(m: number): string {
  return `${(Math.round(m * 100) / 100).toString()}×`;
}
