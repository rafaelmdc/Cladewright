// Crash/refresh recovery for an in-progress Marathon run (#33). The run is fully
// reconstructible from its TRANSCRIPT (the ordered ids the player placed) — replaying it
// through place() rebuilds the exact tree — so we persist just the transcript plus the
// scalar HUD state, keyed by the run's identity. Only ONE in-progress run exists at a time
// (you play one game), so a single localStorage slot is enough.
//
// We clear the slot the moment a run ends (see Marathon), so a restored run can never be
// re-submitted and an old result never resurfaces.

const KEY = "cladewright.run";

export interface SavedRun {
  /** Run identity — a restore only applies when ALL of these match the current game, so a
   *  saved Mammalia·common run never bleeds into an Aves·scientific board. */
  mode: string;
  scope: string;
  difficulty: string;
  assetVersion: number;
  /** Ordered placement ids — replayed to rebuild the tree + remaining tracker. */
  transcript: string[];
  /** Per-placement timestamps (ms since `runStartedAt`), parallel to `transcript`, the
   *  timeline base, and the signed run-session token — persisted so a refresh keeps the run's
   *  combo timings monotonic and the run rankable (#77). */
  timings?: number[];
  runStartedAt?: number;
  runToken?: string | null;
  score: number;
  count: number;
  /** Seconds left at savedAt; restore deducts the wall-clock time the tab was away, so a
   *  refresh can't be used to pause the clock. */
  seconds: number;
  infiniteTime: boolean;
  /** Whether the run is already disqualified from the leaderboard (settings went custom at
   *  some point). Persisted so a refresh can't relaunder a tainted run back to ranked. */
  tainted: boolean;
  savedAt: number;
}

export function saveRun(state: SavedRun): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // private mode / quota — recovery is best-effort, never fatal to the game.
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** The saved run for this exact game, or null if there's none (or it's for a different
 *  game / a rebuilt asset). Does NOT mutate storage. */
export function loadRun(
  mode: string,
  scope: string,
  difficulty: string,
  assetVersion: number,
): SavedRun | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedRun;
    if (
      s.mode !== mode ||
      s.scope !== scope ||
      s.difficulty !== difficulty ||
      s.assetVersion !== assetVersion ||
      !Array.isArray(s.transcript) ||
      s.transcript.length === 0
    ) {
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

/** Seconds remaining after accounting for the time the tab was away. Infinite-time runs
 *  keep their clock; timed runs lose the elapsed wall-clock (so a refresh isn't a pause). */
export function secondsAfterAway(s: SavedRun): number {
  if (s.infiniteTime) return s.seconds;
  const elapsed = Math.floor((Date.now() - s.savedAt) / 1000);
  return Math.max(0, s.seconds - elapsed);
}
