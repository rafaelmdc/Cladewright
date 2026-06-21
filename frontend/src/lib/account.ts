// Account page data: per-game-mode stats + recent runs (for graphs), and account deletion.

import { csrfToken } from "./auth";

export interface ModeStat {
  mode: string;
  label: string;
  games_played: number;
  total_named: number;
  unique_named: number;
  best_score: number;
}

export interface RecentRun {
  mode: string;
  scope: string;
  score: number;
  at: string;
}

export interface AccountStats {
  user: { username: string; email: string; joined: string };
  modes: ModeStat[];
  totals: { games_played: number; total_named: number; unique_named: number };
  recent_runs: RecentRun[];
}

/** null = not authenticated or backend down. */
export async function fetchAccountStats(): Promise<AccountStats | null> {
  try {
    const res = await fetch("/api/auth/stats/", { credentials: "include" });
    if (!res.ok) return null;
    return (await res.json()) as AccountStats;
  } catch {
    return null;
  }
}

/** Permanently delete the account (cascades all runs/stats). true on success. */
export async function deleteAccount(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/account/", {
      method: "DELETE",
      credentials: "include",
      headers: { "X-CSRFToken": csrfToken() },
    });
    return res.status === 204;
  } catch {
    return false;
  }
}
