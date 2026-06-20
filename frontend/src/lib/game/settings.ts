// Tunable game knobs. These are playtest dials (start time, time-per-organism,
// infinite-time for free exploration) — persisted to localStorage so a tuning
// session survives reloads. The "real" defaults will be locked once playtested;
// see docs/marathon-design.md#still-to-settle-by-playtest.

export interface GameSettings {
  /** Free-play: timer never runs down, game never ends. */
  infiniteTime: boolean;
  /** Seconds on the clock at the start of a run. */
  startSeconds: number;
  /** Base seconds added for a NEW placement (before the novelty bonus). */
  timePerNew: number;
  /** Max extra seconds a maximally-novel (root-ish) placement can add. */
  noveltyBonus: number;
  /** Seconds added for a refinement (naming a species under a clade you have). */
  timePerRefinement: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  infiniteTime: false,
  startSeconds: 60,
  timePerNew: 4,
  noveltyBonus: 6,
  timePerRefinement: 2,
};

const KEY = "cladewright.settings.v1";

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore corrupt/unavailable storage */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
