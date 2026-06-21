// Landing hub. One card per game; a shared Common/Scientific difficulty toggle applies to
// every game that supports it (future games reuse the same toggle). A single site-wide
// Daily strip sits on top. See docs/games-model.md.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { LeafMark, TopBar } from "../components/Brand";
import { LeafBackground } from "../components/LeafBackground";
import { fetchDaily, type DailyInfo } from "../lib/daily";
import { fetchGames, FALLBACK_GAMES, type Game } from "../lib/games";
import type { Difficulty } from "../lib/scores";
import { useTitle } from "../lib/useTitle";

export function Hub() {
  useTitle();
  const [difficulty, setDifficulty] = useState<Difficulty>("common");
  // Enabled games come from the admin-toggled config; start with the built-in fallback so
  // the cards paint instantly, then reconcile with the server.
  const [games, setGames] = useState<Game[]>(FALLBACK_GAMES);
  useEffect(() => {
    let alive = true;
    fetchGames().then((g) => {
      if (alive) setGames(g);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Daily modes are surfaced as the single Daily strip, never as cards.
  const cardGames = games.filter((g) => !g.is_daily);
  const anyDifficulty = cardGames.some((g) => g.supports_difficulty);

  return (
    <div className="min-h-screen">
      <LeafBackground density={30} />
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-8">
        <TopBar />

        <div className="flex flex-1 flex-col justify-center gap-5 pb-16">
          <DailyCard difficulty={difficulty} />

          {anyDifficulty && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="mr-1 font-mono text-xs uppercase tracking-wider text-clade-ink/45">
                Difficulty
              </span>
              <button
                type="button"
                onClick={() => setDifficulty("common")}
                className={`pill ${difficulty === "common" ? "pill-active" : ""}`}
              >
                Common names
              </button>
              <button
                type="button"
                onClick={() => setDifficulty("scientific")}
                className={`pill ${difficulty === "scientific" ? "pill-active" : "border-dashed"}`}
              >
                Scientific only
              </button>
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-4">
            {cardGames.map((g) => (
              <ModeCard
                key={g.mode}
                to={g.supports_difficulty ? `${g.route}?difficulty=${difficulty}` : g.route}
                title={g.label}
                blurb={g.blurb}
              />
            ))}
          </div>

          <div className="flex justify-center">
            <Link
              to="/leaderboard"
              className="rounded-full border-2 border-clade-ink/25 px-5 py-2 font-mono text-xs uppercase tracking-widest text-clade-ink/60 transition hover:border-clade-ink/50 hover:text-clade-ink"
            >
              Leaderboards →
            </Link>
          </div>
        </div>

        <p className="text-center font-mono text-[11px] uppercase tracking-wider text-clade-ink/35">
          data: Catalogue of Life · common + scientific
        </p>
      </div>
    </div>
  );
}

/** The single site-wide Daily. The counter is the player's day streak; once today's daily
 * is played, Play is replaced by the score (one shot a day). Reads /api/scores/daily/. */
function DailyCard({ difficulty }: { difficulty: Difficulty }) {
  const [daily, setDaily] = useState<DailyInfo | null>(null);
  useEffect(() => {
    let alive = true;
    fetchDaily().then((d) => {
      if (alive) setDaily(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  const streak = daily?.streak?.current ?? 0;
  const played = daily?.played_today ?? false;

  return (
    <div className="ink-card flex items-center justify-between border-clade-accent/30 px-5 py-4">
      <div className="leading-none">
        <h2 className="font-hand text-3xl font-bold text-clade-ink">Daily</h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">
          {daily?.scope_label ? `today · ${daily.scope_label}` : "day streak"}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right leading-none">
          <div className="font-hand text-4xl font-bold text-clade-ink">{streak}</div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">
            day streak
          </span>
        </div>
        {played ? (
          <div className="text-center leading-none">
            <div className="font-hand text-3xl font-bold text-clade-accent">
              {daily?.today_score ?? "✓"}
            </div>
            <Link
              to="/leaderboard"
              className="font-mono text-[10px] uppercase tracking-widest text-clade-ink/45 underline-offset-2 hover:text-clade-ink hover:underline"
            >
              board →
            </Link>
          </div>
        ) : (
          <Link to={`/marathon?daily=1&difficulty=${difficulty}`} className="btn-play">
            ▶ Play
          </Link>
        )}
      </div>
    </div>
  );
}

function ModeCard({ to, title, blurb }: { to: string; title: string; blurb: string }) {
  return (
    // Same width as the old 2-col grid cell (~half the container) — centered, not widened.
    <div className="ink-card flex w-full flex-col p-5 sm:w-[26rem]">
      <LeafMark className="h-7 w-7 text-clade-accent" />
      <h2 className="mt-2 font-hand text-4xl font-bold leading-none text-clade-ink">{title}</h2>
      <p className="mt-2 font-hand text-xl leading-snug text-clade-ink/70">{blurb}</p>
      <div className="mt-auto pt-4">
        <Link to={to} className="btn-play">
          ▶ Play
        </Link>
      </div>
    </div>
  );
}
