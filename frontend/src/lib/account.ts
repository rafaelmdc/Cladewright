// Account page data: per-game-mode stats + recent runs (for graphs), and account deletion.

import { csrfToken } from "./auth";

export interface ModeStat {
  mode: string;
  difficulty: string;
  game: string; // stable id "mode|difficulty"
  label: string; // composed "Marathon · Common"
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

/** One (day, game) cell with at least one run, for the activity heatmap. The client groups
 * by date and filters by `game` (the chips). */
export interface DayActivity {
  date: string; // YYYY-MM-DD
  game: string; // "mode|difficulty"
  best: number;
  games: number;
}

export interface AccountStats {
  user: { username: string; display_name: string; email: string; joined: string };
  display_name_rules: { min: number; max: number };
  modes: ModeStat[];
  totals: { games_played: number; total_named: number; unique_named: number };
  recent_runs: RecentRun[];
  activity: DayActivity[];
  heatmap_days: number;
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
