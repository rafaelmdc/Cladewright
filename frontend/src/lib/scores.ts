// Score submission + leaderboard read. A run is submitted as its TRANSCRIPT (the ordered
// ids the player placed); the server re-scores it — the client's own count is never the
// source of truth. See docs/architecture.md + apps/scores.

import { csrfToken } from "./auth";

export interface SubmitResult {
  score: number;
  new: number;
  refinements: number;
  duplicates: number;
  unknown: number;
  rank: number;
  run_id: number;
}

export type SubmitOutcome =
  | { ok: true; result: SubmitResult }
  | { ok: false; reason: "auth" | "error" };

export async function submitRun(payload: {
  mode: string;
  scope: string;
  asset_version: number;
  transcript: string[];
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

export interface LeaderEntry {
  rank: number;
  user: string;
  score: number;
  at: string;
}

export async function fetchLeaderboard(mode: string, scope: string): Promise<LeaderEntry[]> {
  try {
    const res = await fetch(
      `/api/scores/leaderboard/?mode=${encodeURIComponent(mode)}&scope=${encodeURIComponent(scope)}`,
    );
    if (!res.ok) return [];
    return ((await res.json()).entries ?? []) as LeaderEntry[];
  } catch {
    return [];
  }
}
