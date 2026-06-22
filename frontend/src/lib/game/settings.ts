// Tunable game knobs. These are playtest dials (start time, time-per-organism, combo
// behaviour, infinite-time for free exploration) — persisted to localStorage so a tuning
// session survives reloads. The *defaults* a fresh run starts from are admin-configurable:
// the backend serves them from GameDefaults (see fetchGameDefaults), and they're applied over
// the hardcoded fallbacks below. See docs/marathon-design.md + docs/admin.md.

export type TreeLayout = "radial" | "rectangular";

export interface GameSettings {
  /** Tree-of-life canvas style: radial (circular) or rectangular phylogram. */
  treeLayout: TreeLayout;
  /** Show the scientific name (smaller) under a species' common name on the tree. */
  showScientific: boolean;
  /** Ambient leaves drifting behind the board (and flung by combo explosions). Purely
   *  visual — never affects scoring or ranked status. */
  fallingLeaves: boolean;
  /** How long a "+seconds" / "no match" flash card lingers before it finishes fading out. */
  flashFadeSeconds: number;
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
  /** Combo keep-alive window: max gap (seconds) between placements to keep a streak. */
  comboWindowSeconds: number;
  /** Combo reward: bonus seconds added per combo step (× the combo level). */
  comboTimeMultiplier: number;
}

/** Hardcoded fallbacks — used until the admin-configured defaults load (and if they can't). */
export const DEFAULT_SETTINGS: GameSettings = {
  treeLayout: "radial",
  showScientific: true,
  fallingLeaves: true,
  flashFadeSeconds: 2,
  extantOnly: true,
  infiniteTime: false,
  startSeconds: 60,
  timePerNew: 10,
  noveltyBonus: 8,
  // Generous for now: deep into a run nearly every placement is a refinement, so this
  // keeps the clock alive. Tune once we have playtest data.
  timePerRefinement: 5,
  comboWindowSeconds: 6,
  comboTimeMultiplier: 1.5,
};

// A run only counts for the leaderboard when its score-affecting modifiers are at their
// defaults — otherwise infinite time / boosted time-per-organism / a juiced combo / an
// extinct-inclusive pool would inflate scores. Visual-only settings (layout, scientific
// names, falling leaves, flash fade) are ignored.
const RANKED_FIELDS: (keyof GameSettings)[] = [
  "infiniteTime",
  "startSeconds",
  "timePerNew",
  "noveltyBonus",
  "timePerRefinement",
  "extantOnly",
  "comboWindowSeconds",
  "comboTimeMultiplier",
];

// The effective defaults: the hardcoded fallbacks, overlaid by whatever the admin configured
// (filled in once fetchGameDefaults resolves). A fresh run and the "ranked" baseline both key
// off THIS, so changing the admin defaults shifts what counts as a default/ranked run.
let runtimeDefaults: GameSettings = { ...DEFAULT_SETTINGS };

/** Current effective defaults (fallbacks + admin config). */
export function gameDefaults(): GameSettings {
  return runtimeDefaults;
}

/** Apply admin-configured defaults (a partial, camelCase, from the API) over the fallbacks. */
export function setGameDefaults(partial: Partial<GameSettings>): void {
  const clean: Partial<GameSettings> = {};
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof GameSettings)[]) {
    if (k in partial && partial[k] != null && typeof partial[k] === typeof DEFAULT_SETTINGS[k]) {
      // @ts-expect-error indexed assignment across the union is sound here (types match above)
      clean[k] = partial[k];
    }
  }
  runtimeDefaults = { ...DEFAULT_SETTINGS, ...clean };
}

/** Fetch admin-configured defaults and apply them. Safe to call early; no-op on failure. */
export async function fetchGameDefaults(): Promise<void> {
  try {
    const res = await fetch("/api/scores/game-defaults/");
    if (!res.ok) return;
    setGameDefaults((await res.json()) as Partial<GameSettings>);
  } catch {
    /* offline / backend down — keep the fallbacks */
  }
}

export function isRankedSettings(s: GameSettings): boolean {
  return RANKED_FIELDS.every((k) => s[k] === runtimeDefaults[k]);
}

const KEY = "cladewright.settings.v1";

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...runtimeDefaults, ...JSON.parse(raw) };
  } catch {
    /* ignore corrupt/unavailable storage */
  }
  return { ...runtimeDefaults };
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
