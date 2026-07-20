// Tunable game knobs. These are playtest dials (start time, time-per-organism, combo
// behaviour, infinite-time for free exploration) — persisted to localStorage so a tuning
// session survives reloads. The *defaults* a fresh run starts from are admin-configurable:
// the backend serves them from GameDefaults (see fetchGameDefaults), and they're applied over
// the hardcoded fallbacks below. See docs/marathon-design.md + docs/admin.md.

export type TreeLayout = "radial" | "rectangular";

/** Which name(s) a specimen shows. A GAMEPLAY choice, not a visual one: "scientific" is a
 *  genuinely harder game (you must recognise the binomial), so it's lobby-owned, frozen at
 *  start, and rides in the shared config code — unlike the cosmetic VISUAL_KEYS. */
export type NameLens = "common" | "both" | "scientific";

export interface GameSettings {
  /** Tree-of-life canvas style: radial (circular) or rectangular phylogram. */
  treeLayout: TreeLayout;
  /** Show the scientific name (smaller) under a species' common name on the tree. */
  showScientific: boolean;
  /** Which name(s) a specimen card shows: common only, both, or scientific only. */
  nameLens: NameLens;
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
  /** Combo reward: bonus POINTS added per combo step (× the combo level); capped per
   *  placement. The server re-derives this from the run's timings, so it can't be forged. */
  comboScoreMultiplier: number;
  /** Clade-completion reward strength: bonus points ≈ this × √(clade size). 0 disables. */
  cladeScoreMultiplier: number;
  /** Smallest clade size that earns a completion bonus. */
  cladeMinSize: number;
}

/** Hardcoded fallbacks — used until the admin-configured defaults load (and if they can't). */
export const DEFAULT_SETTINGS: GameSettings = {
  treeLayout: "radial",
  showScientific: true,
  nameLens: "both", // what Clade Clash already showed before this was configurable
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
  comboScoreMultiplier: 1.0,
  cladeScoreMultiplier: 2.0,
  cladeMinSize: 3,
};


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

/** Fetch a game's admin-configured defaults and apply them. Safe to call early; no-op on
 *  failure. `mode` selects the game (Marathon's free + daily share one set); omit for Marathon. */
export async function fetchGameDefaults(mode?: string): Promise<void> {
  try {
    const qs = mode ? `?mode=${encodeURIComponent(mode)}` : "";
    const res = await fetch(`/api/scores/game-defaults/${qs}`);
    if (!res.ok) return;
    setGameDefaults((await res.json()) as Partial<GameSettings>);
  } catch {
    /* offline / backend down — keep the fallbacks */
  }
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

// Visual prefs are GLOBAL — cross-run, cross-game — and never affect score. They live apart
// from a run's GameConfig: the in-game gear edits these (the only thing tunable mid-run); the
// lobby owns the gameplay settings, frozen at start. Kept in sync with the schema's
// `visual: true` fields (lib/game/schema.ts). A shared config code carries gameplay, never
// these personal display choices. See docs/lobby-and-config.md.
export const VISUAL_KEYS = [
  "treeLayout",
  "showScientific",
  "fallingLeaves",
  "flashFadeSeconds",
] as const satisfies readonly (keyof GameSettings)[];

const VISUAL_KEY = "cladewright.visual.v1";

export function loadVisualPrefs(): Partial<GameSettings> {
  try {
    const raw = localStorage.getItem(VISUAL_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Partial<GameSettings>;
    const out: Partial<GameSettings> = {};
    for (const k of VISUAL_KEYS) if (k in obj) (out as Record<string, unknown>)[k] = obj[k];
    return out;
  } catch {
    return {};
  }
}

export function saveVisualPrefs(s: GameSettings): void {
  try {
    const out: Partial<GameSettings> = {};
    for (const k of VISUAL_KEYS) (out as Record<string, unknown>)[k] = s[k];
    localStorage.setItem(VISUAL_KEY, JSON.stringify(out));
  } catch {
    /* ignore */
  }
}

/** Overlay the player's global visual prefs onto a run's settings (gameplay untouched). */
export function applyVisualPrefs(s: GameSettings): GameSettings {
  return { ...s, ...loadVisualPrefs() };
}
