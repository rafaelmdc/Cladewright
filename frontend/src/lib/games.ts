// Enabled game modes, served from /api/scores/games/ (admin-toggled via GameModeConfig).
// The Hub and the leaderboard read this so a game can be launched/retired without a deploy.
// A built-in fallback keeps Marathon visible if the API is unreachable or the table is
// empty (fresh DB) — the game is never dark just because config hasn't loaded.

export interface Game {
  mode: string;
  label: string;
  blurb: string;
  route: string;
  supports_difficulty: boolean;
  is_daily: boolean; // daily modes are the Hub's single Daily strip, NOT a card
}

// Shown when the API can't be reached. Mirrors the seeded marathon_free row, with the
// richer Hub blurb the design uses.
export const FALLBACK_GAMES: Game[] = [
  {
    mode: "marathon_free",
    label: "Marathon",
    blurb:
      "Name as many organisms as you can against the clock — each one lands on a living tree you build. Empty branches show how many sisters stay hidden. Zoom in to hunt them.",
    route: "/marathon",
    supports_difficulty: true,
    is_daily: false,
  },
];

export async function fetchGames(): Promise<Game[]> {
  try {
    const res = await fetch("/api/scores/games/", { credentials: "include" });
    if (!res.ok) return FALLBACK_GAMES;
    const data = (await res.json()) as { games?: Game[] };
    return data.games && data.games.length > 0 ? data.games : FALLBACK_GAMES;
  } catch {
    return FALLBACK_GAMES;
  }
}
