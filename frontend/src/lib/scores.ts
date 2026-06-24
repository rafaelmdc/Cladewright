// Score submission + leaderboard read. A run is submitted as its TRANSCRIPT (the ordered
// ids the player placed); the server re-scores it — the client's own count is never the
// source of truth. See docs/architecture.md + apps/scores.

import { csrfToken } from "./auth";

export type Difficulty = "common" | "scientific";

export interface SubmitResult {
  score: number;
  /** Base placements (pre-bonus), plus the two bonus components that make up `score`. */
  base?: number;
  combo_bonus?: number;
  clade_bonus?: number;
  new: number;
  refinements: number;
  duplicates: number;
  unknown: number;
  // null for an unranked run (recorded to stats, but not placed on the leaderboard).
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
  ranked: boolean;
  /** Per-placement timestamps (ms since the first placement), parallel to `transcript` —
   *  the server re-derives the combo bonus from these. */
  timings?: number[];
  /** Signed run-session token from `startRun`. */
  run_token?: string | null;
  /** Whether the run was played living-only — picks the clade-completion denominator for an
   *  unranked custom run (ranked runs always use the server default). */
  extant_only?: boolean;
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

// ── Pending run across the sign-in redirect ──────────────────────────────────────
// Signing in is a top-level OAuth redirect, so the in-memory run is lost. When a
// logged-out player taps "sign in to save", we stash the run here first; after they
// land back authenticated, PendingRunFlusher submits it. See GitHub issue #78.

const PENDING_KEY = "cw.pendingRun";
// Drop a stash older than this — a run is only worth auto-saving right after the redirect,
// not days later from a forgotten tab. Generous enough to cover the OAuth round-trip.
const PENDING_TTL_MS = 60 * 60 * 1000; // 1h

export interface PendingRun {
  payload: Parameters<typeof submitRun>[0];
  // For the confirmation toast, so we don't re-derive labels post-redirect.
  count: number;
  score: number;
  scopeLabel: string;
  at: number; // epoch ms when stashed
}

/** Persist a just-finished run before the sign-in redirect so it survives the round-trip. */
export function stashPendingRun(run: Omit<PendingRun, "at">): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...run, at: Date.now() }));
  } catch {
    /* storage unavailable — the run just won't auto-save */
  }
}

/** Read and CLEAR the stashed run, or null if absent/expired/corrupt. */
export function takePendingRun(): PendingRun | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PENDING_KEY);
    if (raw) localStorage.removeItem(PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const run = JSON.parse(raw) as PendingRun;
    if (!run?.payload?.transcript?.length) return null;
    if (Date.now() - (run.at ?? 0) > PENDING_TTL_MS) return null;
    return run;
  } catch {
    return null;
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
