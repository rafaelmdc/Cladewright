// Today's single site-wide daily (the Hub strip + the daily play mode read this). One
// shared puzzle a day: a fixed scope + default settings, ranked, one shot. See
// docs/games-model.md and apps/scores DailyView.

export interface DailyInfo {
  date: string;
  mode: string; // e.g. "marathon_daily"
  available: boolean;
  scope: string | null;
  scope_label: string | null;
  // Present only when signed in:
  streak?: { current: number; best: number };
  played_today?: boolean;
  today_score?: number | null;
}

/** null = backend down. Callers fall back to a neutral state. */
export async function fetchDaily(): Promise<DailyInfo | null> {
  try {
    const res = await fetch("/api/scores/daily/", { credentials: "include" });
    if (!res.ok) return null;
    return (await res.json()) as DailyInfo;
  } catch {
    return null;
  }
}
