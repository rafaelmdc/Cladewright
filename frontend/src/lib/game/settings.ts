// Tunable game knobs. These are playtest dials (start time, time-per-organism,
// infinite-time for free exploration) — persisted to localStorage so a tuning
// session survives reloads. The "real" defaults will be locked once playtested;
// see docs/marathon-design.md#still-to-settle-by-playtest.

export type TreeLayout = "radial" | "rectangular";

export interface GameSettings {
  /** Tree-of-life canvas style: radial (circular) or rectangular phylogram. */
  treeLayout: TreeLayout;
  /** Show the scientific name (smaller) under a species' common name on the tree. */
  showScientific: boolean;
  /** "Living only": exclude extinct species — they don't count and the "N remaining"
   *  denominator switches to the extant-only counts. Off = include extinct. */
  extantOnly: boolean;
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
  treeLayout: "radial",
  showScientific: true,
  extantOnly: true,
  infiniteTime: false,
  startSeconds: 60,
  timePerNew: 10,
  noveltyBonus: 8,
  // Generous for now: deep into a run nearly every placement is a refinement, so this
  // keeps the clock alive. Tune once we have playtest data.
  timePerRefinement: 5,
};

// A run only counts for the leaderboard when its score-affecting modifiers are at their
// defaults — otherwise infinite time / boosted time-per-organism / an extinct-inclusive
// pool would inflate scores. Visual-only settings (layout, scientific names) are ignored.
const RANKED_FIELDS: (keyof GameSettings)[] = [
  "infiniteTime",
  "startSeconds",
  "timePerNew",
  "noveltyBonus",
  "timePerRefinement",
  "extantOnly",
];

export function isRankedSettings(s: GameSettings): boolean {
  return RANKED_FIELDS.every((k) => s[k] === DEFAULT_SETTINGS[k]);
}

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
