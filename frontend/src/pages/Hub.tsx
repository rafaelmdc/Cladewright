// Landing hub — a clean game picker. One card per game (links to that game's lobby, where you
// pick packs + difficulty + settings); a single site-wide Daily strip on top. Difficulty and
// pack selection used to live here — they moved into the per-game lobby (/play/:mode) so the
// hub stays uncluttered as more games arrive. See docs/lobby-and-config.md + games-model.md.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { LeafMark, TopBar } from "../components/Brand";
import { LeafBackground } from "../components/LeafBackground";
import { OnboardingTour } from "../components/onboarding/OnboardingTour";
import { HUB_STEPS } from "../components/onboarding/tourSteps";
import { fetchDaily, type DailyInfo } from "../lib/daily";
import { fetchGames, FALLBACK_GAMES, type Game } from "../lib/games";
import { useTitle } from "../lib/useTitle";
import { fetchApiVersion, FRONTEND_BUILT, FRONTEND_VERSION } from "../lib/version";

export function Hub() {
  useTitle();
  const [tourOpen, setTourOpen] = useState(false);

  // Enabled games come from the admin-toggled config; start with the built-in fallback so the
  // cards paint instantly, then reconcile with the server.
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

  return (
    <div className="min-h-screen">
      <LeafBackground density={30} />
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-8">
        <TopBar />

        <div className="flex flex-1 flex-col justify-center gap-5 pb-16">
          <div data-tour="daily">
            <DailyCard />
          </div>

          <div className="flex flex-wrap justify-center gap-4">
            {cardGames.map((g) => (
              <ModeCard key={g.mode} to={`/play/${g.mode}`} title={g.label} blurb={g.blurb} />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setTourOpen(true)}
              className="rounded-full border-2 border-clade-ink/25 px-5 py-2 font-mono text-xs uppercase tracking-widest text-clade-ink/60 transition hover:border-clade-accent hover:text-clade-ink"
            >
              How to play
            </button>
            <Link
              to="/leaderboard"
              className="rounded-full border-2 border-clade-ink/25 px-5 py-2 font-mono text-xs uppercase tracking-widest text-clade-ink/60 transition hover:border-clade-ink/50 hover:text-clade-ink"
            >
              Leaderboards →
            </Link>
          </div>
        </div>

        <OnboardingTour open={tourOpen} onClose={() => setTourOpen(false)} steps={HUB_STEPS} />

        <p className="text-center font-mono text-[11px] uppercase tracking-wider text-clade-ink/35">
          data: Catalogue of Life · common + scientific ·{" "}
          <Link
            to="/faq"
            className="underline decoration-clade-ink/25 underline-offset-2 transition hover:text-clade-ink/70 hover:decoration-clade-ink/50"
          >
            FAQ
          </Link>{" "}
          ·{" "}
          <a
            href="https://github.com/rafaelmdc/Cladewright/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-clade-ink/25 underline-offset-2 transition hover:text-clade-ink/70 hover:decoration-clade-ink/50"
          >
            report a bug ↗
          </a>{" "}
          · <BuildTag />
        </p>
      </div>
    </div>
  );
}

/** The single site-wide Daily. The counter is the player's day streak; once today's daily is
 * played, Play is replaced by the score (one shot a day). The daily bypasses the lobby — its
 * config is server-fixed and locked — so Play links straight to the board. Reads /api/scores/daily/. */
function DailyCard() {
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
    // The daily is a SECONDARY action, deliberately styled apart from the primary green
    // "▶ Play" cards (#64): a distinct label, an outlined button, and a one-line "what is this".
    <div className="ink-card flex items-center justify-between border-clade-accent/30 px-5 py-4">
      <div className="leading-none">
        <h2 className="font-hand text-3xl font-bold text-clade-ink">Daily</h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">
          {daily?.scope_label ? `one a day · ${daily.scope_label}` : "one shared puzzle, once a day"}
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
          <Link
            to="/marathon?daily=1"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-clade-accent px-4 py-1.5 font-hand text-xl font-bold text-clade-accent transition hover:bg-clade-accent hover:text-clade-paper"
          >
            ▶ Today's puzzle
          </Link>
        )}
      </div>
    </div>
  );
}

function ModeCard({ to, title, blurb }: { to: string; title: string; blurb: string }) {
  return (
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

/** Build stamp: the frontend's baked version + the live API's version. They normally match
 *  (built from the same commit); a mismatch (shown amber) flags a half-applied deploy. */
function BuildTag() {
  const [api, setApi] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchApiVersion().then((v) => {
      if (alive) setApi(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  const skew = api !== null && api !== FRONTEND_VERSION;
  return (
    <span title={FRONTEND_BUILT ? `built ${FRONTEND_BUILT}` : undefined}>
      {FRONTEND_VERSION}
      {skew && <span className="text-amber-600"> · api {api}</span>}
    </span>
  );
}
