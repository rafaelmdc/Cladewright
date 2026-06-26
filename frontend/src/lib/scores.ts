// Score submission + leaderboard read. A run is submitted as its TRANSCRIPT (the ordered
// ids the player placed); the server re-scores it — the client's own count is never the
// source of truth. See docs/architecture.md + apps/scores.

import { csrfToken } from "./auth";

export type Difficulty = "common" | "scientific";

export interface SubmitResult {
  /** Board score = base_score × score_multiplier (#101) — what the leaderboard ranks by. */
  score: number;
  /** The re-scored result BEFORE the multiplier (placements + combo/clade bonuses). */
  base_score?: number;
  /** Multiplier the server resolved from the run's modifiers + settings (1.0 = default setup). */
  score_multiplier?: number;
  /** Base placements (pre-bonus), plus the two bonus components that make up `base_score`. */
  base?: number;
  combo_bonus?: number;
  clade_bonus?: number;
  new: number;
  refinements: number;
  duplicates: number;
  unknown: number;
  // null when the run didn't pass anti-cheat (recorded to stats, but not placed on the board).
  rank: number | null;
  ranked: boolean;
  run_id: number;
}

export type SubmitOutcome =
  | { ok: true; result: SubmitResult }
  | { ok: false; reason: "auth" | "error" };

/** Open a signed run session (#77). The token anchors the run's combo timings to a real
 *  server start time so the combo/clade score can't be forged; returned to the server at
 *  submit. Null if the player isn't signed in or the call fails — the run just won't rank. */
export async function startRun(): Promise<string | null> {
  try {
    const res = await fetch("/api/scores/runs/start/", {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRFToken": csrfToken() },
    });
    if (!res.ok) return null;
    return ((await res.json()) as { token?: string }).token ?? null;
  } catch {
    return null;
  }
}

export async function submitRun(payload: {
  mode: string;
  scope: string;
  difficulty: Difficulty;
  asset_version: number;
  transcript: string[];
  /** Per-placement timestamps (ms since the first placement), parallel to `transcript` —
   *  the server re-derives the combo bonus from these. */
  timings?: number[];
  /** Signed run-session token from `startRun`. */
  run_token?: string | null;
  /** The run's gameplay settings (camelCase) — the server resolves the score multiplier from
   *  any score-easing deviations (#101). Includes `extantOnly` (the clade-completion lens). */
  settings?: Record<string, unknown>;
  /** Active gameplay modifier keys — the server multiplies the score by their resolved factor. */
  modifiers?: string[];
}): Promise<SubmitOutcome> {
  try {
    const res = await fetch("/api/scores/runs/", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
      body: JSON.stringify(payload),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "auth" };
    if (!res.ok) return { ok: false, reason: "error" };
    return { ok: true, result: (await res.json()) as SubmitResult };
  } catch {
    return { ok: false, reason: "error" };
  }
}

// ── Signed-out run cache (import after sign-in) ───────────────────────────────────
// Runs finished while signed out are cached here for 5 minutes (localStorage, so they survive
// the OAuth redirect). After the player signs in, RunImporter offers to add them to their
// profile in one go. Supersedes the single-run stash of #78. See GitHub issue #107.

const CACHE_KEY = "cw.cachedRuns";
// #107: a run finished while signed out is kept this long, so signing in shortly after can
// offer to import it. Short on purpose — it's "the runs you just played", not a forgotten tab.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const CACHE_MAX = 10; // cap the stash so a long signed-out streak can't bloat localStorage

export interface CachedRun {
  payload: Parameters<typeof submitRun>[0];
  // For the import popup, so we don't re-derive labels.
  count: number;
  score: number;
  scopeLabel: string;
  at: number; // epoch ms when cached
}

function readCache(): CachedRun[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as CachedRun[];
    const now = Date.now();
    return arr.filter(
      (r) => r?.payload?.transcript?.length && now - (r.at ?? 0) <= CACHE_TTL_MS,
    );
  } catch {
    return [];
  }
}

function writeCache(runs: CachedRun[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(runs));
  } catch {
    /* storage unavailable — caching is best-effort */
  }
}

/** Cache a run finished while signed OUT, so a sign-in within 5 min can offer to import it
 *  (#107). Prunes expired entries and keeps only the most recent few. */
export function cacheRun(run: Omit<CachedRun, "at">): void {
  const runs = readCache();
  runs.push({ ...run, at: Date.now() });
  writeCache(runs.slice(-CACHE_MAX));
}

/** The fresh (≤5 min) cached runs, newest last. Prunes expired ones; does NOT clear. */
export function peekCachedRuns(): CachedRun[] {
  const runs = readCache();
  writeCache(runs); // persist the pruned list
  return runs;
}

/** Drop every cached run (after importing, or when the player declines). */
export function clearCachedRuns(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export interface LeaderEntry {
  rank: number;
  user: string;
  score: number;
  at: string;
}

export interface Board {
  entries: LeaderEntry[];
  scope_label: string;
  date: string | null; // set for daily boards (date-indexed); null for free-play
}

/** `date` (YYYY-MM-DD) selects a daily board's day; ignored for free-play boards. For daily
 * boards the server derives the scope from the date, so `scope` may be left empty. */
export async function fetchLeaderboard(
  mode: string,
  scope: string,
  difficulty: Difficulty,
  date?: string,
): Promise<Board> {
  const empty: Board = { entries: [], scope_label: "", date: date ?? null };
  try {
    const q = new URLSearchParams({ mode, scope, difficulty });
    if (date) q.set("date", date);
    const res = await fetch(`/api/scores/leaderboard/?${q.toString()}`);
    if (!res.ok) return empty;
    const data = await res.json();
    return {
      entries: (data.entries ?? []) as LeaderEntry[],
      scope_label: data.scope_label ?? "",
      date: data.date ?? null,
    };
  } catch {
    return empty;
  }
}
