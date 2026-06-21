// Browsable leaderboards. Boards are a matrix of (scope × difficulty), so the page pairs
// a scope picker with a difficulty toggle and shows the top players for the chosen board.
// Reached from the Hub; reuses the Marathon scope picker so the control reads the same.

import { useEffect, useState } from "react";

import { LeafBackground } from "../components/LeafBackground";
import { TopBar } from "../components/Brand";
import { ScopePicker } from "../components/ScopePicker";
import { fetchMe, type Me } from "../lib/auth";
import { fetchScopes, type ScopeInfo } from "../lib/asset/scopes";
import { fetchGames, FALLBACK_GAMES, type Game } from "../lib/games";
import { fetchLeaderboard, type Difficulty, type LeaderEntry } from "../lib/scores";
import { useTitle } from "../lib/useTitle";

export function Leaderboard() {
  useTitle("Leaderboards");
  // Boards are game-specific: each enabled mode has its own (scope × difficulty) matrix.
  const [games, setGames] = useState<Game[]>(FALLBACK_GAMES);
  const [mode, setMode] = useState<string>(FALLBACK_GAMES[0].mode);
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  const [scopeKey, setScopeKey] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("common");
  const [board, setBoard] = useState<LeaderEntry[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(false);

  const activeGame = games.find((g) => g.mode === mode) ?? games[0];

  useEffect(() => {
    fetchMe().then(setMe);
    fetchScopes().then((list) => {
      setScopes(list);
      setScopeKey(list[0]?.key ?? null);
    });
    fetchGames().then((g) => {
      setGames(g);
      if (g.length > 0 && !g.some((x) => x.mode === mode)) setMode(g[0].mode);
    });
    // mode intentionally omitted: this only seeds the initial game list once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!scopeKey) return;
    let live = true;
    setLoading(true);
    fetchLeaderboard(mode, scopeKey, difficulty).then((entries) => {
      if (!live) return;
      setBoard(entries);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [mode, scopeKey, difficulty]);

  return (
    <div className="min-h-screen w-screen px-4 py-8">
      <LeafBackground density={20} />
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <TopBar />

        <h1 className="font-hand text-5xl font-bold text-clade-ink">Leaderboards</h1>

        {games.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {games.map((g) => (
              <button
                key={g.mode}
                type="button"
                onClick={() => setMode(g.mode)}
                className={`pill ${g.mode === mode ? "pill-active" : ""}`}
              >
                {g.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <ScopePicker scopes={scopes} value={scopeKey} onChange={setScopeKey} />
          {activeGame?.supports_difficulty && (
            <div className="flex gap-2">
              <DiffPill active={difficulty === "common"} onClick={() => setDifficulty("common")}>
                Common
              </DiffPill>
              <DiffPill active={difficulty === "scientific"} onClick={() => setDifficulty("scientific")}>
                Scientific
              </DiffPill>
            </div>
          )}
        </div>

        <section className="ink-card bg-clade-paper px-6 py-5">
          {loading ? (
            <p className="font-mono text-xs text-clade-ink/40">Loading…</p>
          ) : board.length === 0 ? (
            <p className="font-mono text-sm text-clade-ink/45">No runs on this board yet — be the first.</p>
          ) : (
            <ol className="space-y-0.5">
              {board.map((e) => {
                const mine = me?.authenticated && e.user === me.username;
                return (
                  <li
                    key={`${e.rank}-${e.user}`}
                    className={`flex items-baseline justify-between rounded-lg px-3 py-1.5 ${
                      mine ? "bg-clade-accentSoft/70" : ""
                    }`}
                  >
                    <span className="flex items-baseline gap-3 truncate">
                      <span className="w-6 shrink-0 font-mono text-xs text-clade-ink/45">{e.rank}</span>
                      <span className="truncate font-hand text-xl text-clade-ink">{e.user}</span>
                    </span>
                    <span className="font-mono text-sm text-clade-ink/70">{e.score}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function DiffPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={`pill ${active ? "pill-active" : "border-dashed"}`}>
      {children}
    </button>
  );
}
