// Landing hub — pick a mode. Mirrors docs/examples/homepage.png: leaf wordmark + nav,
// a big handwritten headline, two mode cards with play buttons, difficulty pills, all
// over the drifting-leaf background.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { LeafMark, TopBar } from "../components/Brand";
import { LeafBackground } from "../components/LeafBackground";
import { fetchGames, FALLBACK_GAMES, type Game } from "../lib/games";
import type { Difficulty } from "../lib/scores";
import { useTitle } from "../lib/useTitle";

export function Hub() {
  useTitle();
  const [difficulty, setDifficulty] = useState<Difficulty>("common");
  // Enabled games come from the admin-toggled config; start with the built-in fallback so
  // the card paints instantly, then reconcile with the server.
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

  const anyDifficulty = games.some((g) => g.supports_difficulty);

  return (
    <div className="min-h-screen">
      <LeafBackground density={30} />
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
        <TopBar />

        <div className="flex flex-1 flex-col items-center justify-center gap-6 pb-16">
          <p className="text-center font-mono text-xs uppercase tracking-wider text-clade-ink/45">
            data: Catalogue of Life · every taxon shown common + scientific
          </p>

          <div className="grid w-full max-w-2xl gap-4">
            {games.map((g) => (
              <ModeCard
                key={g.mode}
                to={g.supports_difficulty ? `${g.route}?difficulty=${difficulty}` : g.route}
                title={g.label}
                blurb={g.blurb}
                meta="grow the tree"
              />
            ))}
          </div>

          {anyDifficulty && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span className="font-mono text-xs uppercase tracking-wider text-clade-ink/45">
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

          <Link
            to="/leaderboard"
            className="font-mono text-xs uppercase tracking-widest text-clade-ink/45 underline-offset-4 hover:text-clade-ink hover:underline"
          >
            Leaderboards →
          </Link>
        </div>
      </div>
    </div>
  );
}

function ModeCard({
  to,
  title,
  blurb,
  meta,
  tag,
}: {
  to: string;
  title: string;
  blurb: string;
  meta: string;
  tag?: string;
}) {
  return (
    <div className="ink-card flex flex-col p-6">
      <LeafMark className="h-8 w-8 text-clade-accent" />
      <div className="mt-3 flex items-center gap-2">
        <h2 className="font-hand text-5xl font-bold leading-none text-clade-ink">{title}</h2>
        {tag && (
          <span className="rounded-full bg-clade-ink px-2 py-0.5 font-mono text-[10px] tracking-wider text-clade-bg">
            {tag}
          </span>
        )}
      </div>
      <p className="mt-3 font-hand text-2xl leading-snug text-clade-ink/70">{blurb}</p>
      <div className="mt-auto flex items-center justify-between pt-5">
        <Link to={to} className="btn-play">
          ▶ Play
        </Link>
        <span className="font-mono text-xs text-clade-ink/45">{meta}</span>
      </div>
    </div>
  );
}
