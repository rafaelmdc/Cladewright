// Landing hub. One card per game; a shared Common/Scientific difficulty toggle applies to
// every game that supports it (future games reuse the same toggle). A single site-wide
// Daily strip sits on top. See docs/games-model.md.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { LeafMark, TopBar } from "../components/Brand";
import { LeafBackground } from "../components/LeafBackground";
import { fetchScopes, type ScopeInfo } from "../lib/asset/scopes";
import { fetchDaily, type DailyInfo } from "../lib/daily";
import { fetchGames, FALLBACK_GAMES, type Game } from "../lib/games";
import type { Difficulty } from "../lib/scores";
import { useTitle } from "../lib/useTitle";

// Shared with Marathon's scope memory: the picked mix carries over either way.
const SCOPE_KEY = "cladewright.scope";

export function Hub() {
  useTitle();
  const [difficulty, setDifficulty] = useState<Difficulty>("common");

  // Scope mixing: the player toggles which clades to play; the selection rides to the game
  // as ?scopes=mammalia,aves and the assets merge there. Only blob scopes are mixable.
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    fetchScopes().then((list) => {
      if (!alive) return;
      const blob = list.filter((s) => s.mode === "blob");
      setScopes(blob);
      const remembered = (localStorage.getItem(SCOPE_KEY) ?? "")
        .split(",")
        .filter((k) => blob.some((s) => s.key === k));
      setSelectedScopes(remembered.length ? remembered : blob[0] ? [blob[0].key] : []);
    });
    return () => {
      alive = false;
    };
  }, []);

  function toggleScope(key: string) {
    setSelectedScopes((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      const result = next.length ? next : prev; // never let the selection go empty
      localStorage.setItem(SCOPE_KEY, result.join(","));
      return result;
    });
  }

  // A card's link carries the current difficulty (if it supports it) + the scope mix.
  function gameHref(g: Game): string {
    const p = new URLSearchParams();
    if (g.supports_difficulty) p.set("difficulty", difficulty);
    if (selectedScopes.length) p.set("scopes", selectedScopes.join(","));
    const qs = p.toString();
    return qs ? `${g.route}?${qs}` : g.route;
  }
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
  const totalSelectedTips = scopes
    .filter((s) => selectedScopes.includes(s.key))
    .reduce((n, s) => n + s.tip_count, 0);

  return (
    <div className="min-h-screen">
      <LeafBackground density={30} />
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-8">
        <TopBar />

        <div className="flex flex-1 flex-col justify-center gap-5 pb-16">
          <DailyCard difficulty={difficulty} />

          {anyDifficulty && (
            // One row, never wrapping: a short "Difficulty" label + a two-option segmented
            // toggle. Shortened labels ("Common"/"Scientific") keep it on a single line down
            // to the narrowest phones instead of spilling onto two.
            <div className="flex flex-nowrap items-center justify-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-clade-ink/45 sm:text-xs">
                Difficulty
              </span>
              <button
                type="button"
                onClick={() => setDifficulty("common")}
                className={`pill whitespace-nowrap ${difficulty === "common" ? "pill-active" : ""}`}
              >
                Common
              </button>
              <button
                type="button"
                onClick={() => setDifficulty("scientific")}
                className={`pill whitespace-nowrap ${difficulty === "scientific" ? "pill-active" : "border-dashed"}`}
              >
                Scientific
              </button>
            </div>
          )}

          {scopes.length > 0 && (
            // Scope toggles — pick one clade or mix several (their trees merge in-game).
            // Selected = filled brand-green (on-brand + obvious vs the ghost outline of the
            // unselected); each shows its species count, with a running mix summary below.
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-clade-ink/45 sm:text-xs">
                  Clades
                </span>
                {scopes.map((s) => {
                  const on = selectedScopes.includes(s.key);
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => toggleScope(s.key)}
                      aria-pressed={on}
                      className={`flex items-center gap-2 whitespace-nowrap rounded-full border-2 px-4 py-1.5 font-mono text-sm transition ${
                        on
                          ? "border-clade-accent bg-clade-accent text-clade-paper shadow-sm"
                          : "border-clade-ink/25 text-clade-ink/70 hover:border-clade-accent/70 hover:text-clade-ink"
                      }`}
                    >
                      <span>{s.label}</span>
                      <span
                        className={`font-mono text-[10px] ${on ? "text-clade-paper/65" : "text-clade-ink/35"}`}
                      >
                        {s.tip_count.toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
              <span className="font-mono text-[10px] text-clade-ink/40">
                {selectedScopes.length > 1
                  ? `mixing ${selectedScopes.length} clades · ${totalSelectedTips.toLocaleString()} species`
                  : "pick one, or tap several to mix"}
              </span>
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-4">
            {cardGames.map((g) => (
              <ModeCard key={g.mode} to={gameHref(g)} title={g.label} blurb={g.blurb} />
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
          data: Catalogue of Life · common + scientific ·{" "}
          <a
            href="https://github.com/rafaelmdc/Cladewright/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-clade-ink/25 underline-offset-2 transition hover:text-clade-ink/70 hover:decoration-clade-ink/50"
          >
            report a bug ↗
          </a>
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
