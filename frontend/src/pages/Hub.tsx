// Landing hub. A game = (base × difficulty): each difficulty-supporting game shows two
// cards (Common / Scientific) — the lens IS the card, no toggle. A single site-wide Daily
// strip sits on top (its own dopamine zone). See docs/games-model.md.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { LeafMark, TopBar } from "../components/Brand";
import { LeafBackground } from "../components/LeafBackground";
import { fetchGames, FALLBACK_GAMES, type Game } from "../lib/games";
import type { Difficulty } from "../lib/scores";
import { useTitle } from "../lib/useTitle";

const LENSES: { id: Difficulty; label: string }[] = [
  { id: "common", label: "Common names" },
  { id: "scientific", label: "Scientific only" },
];

interface Card {
  key: string;
  to: string;
  title: string;
  lens: string | null;
  blurb: string;
}

export function Hub() {
  useTitle();
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

  // One card per (game × lens): the lens is the card, not a toggle.
  const cards: Card[] = games.flatMap((g): Card[] =>
    g.supports_difficulty
      ? LENSES.map((l) => ({
          key: `${g.mode}-${l.id}`,
          to: `${g.route}?difficulty=${l.id}`,
          title: g.label,
          lens: l.label,
          blurb: g.blurb,
        }))
      : [{ key: g.mode, to: g.route, title: g.label, lens: null, blurb: g.blurb }],
  );

  return (
    <div className="min-h-screen">
      <LeafBackground density={30} />
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-8">
        <TopBar />

        <div className="flex flex-1 flex-col justify-center gap-5 pb-16">
          <DailyCard />

          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map((c) => (
              <ModeCard key={c.key} to={c.to} title={c.title} lens={c.lens} blurb={c.blurb} />
            ))}
          </div>

          <div className="flex items-center justify-between font-mono text-xs uppercase tracking-wider text-clade-ink/45">
            <span>data: Catalogue of Life · common + scientific</span>
            <Link
              to="/leaderboard"
              className="tracking-widest underline-offset-4 hover:text-clade-ink hover:underline"
            >
              Leaderboards →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The single site-wide Daily — present and clean, a teaser until the daily mode ships.
 * One puzzle a day for everyone; keeping the streak is what brings players back. */
function DailyCard() {
  return (
    <div className="ink-card flex items-center gap-4 border-clade-accent/40 bg-clade-accent/[0.06] px-5 py-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-clade-accent/15 text-2xl">
        🔥
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="font-hand text-3xl font-bold leading-none text-clade-ink">Daily</h2>
          <span className="rounded-full border border-clade-accent/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-clade-accent">
            soon
          </span>
        </div>
        <p className="mt-1 font-mono text-xs text-clade-ink/55">
          One shared puzzle every day — build a streak.
        </p>
      </div>
    </div>
  );
}

function ModeCard({ to, title, lens, blurb }: Omit<Card, "key">) {
  return (
    <div className="ink-card flex flex-col p-5">
      <div className="flex items-start justify-between">
        <LeafMark className="h-7 w-7 text-clade-accent" />
        {lens && (
          <span className="rounded-full bg-clade-ink px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-clade-bg">
            {lens}
          </span>
        )}
      </div>
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
