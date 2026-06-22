// Browsable leaderboards. A game dropdown picks the board; free-play boards are an
// all-time (scope × difficulty) matrix, while the daily board is date-indexed with history
// (◀/▶) and a server-decided scope. See docs/games-model.md.

import { useEffect, useState } from "react";

import { LeafBackground } from "../components/LeafBackground";
import { TopBar } from "../components/Brand";
import { ScopePicker } from "../components/ScopePicker";
import { fetchMe, type Me } from "../lib/auth";
import { fetchScopes, type ScopeInfo } from "../lib/asset/scopes";
import { fetchGames, FALLBACK_GAMES, type Game } from "../lib/games";
import { fetchLeaderboard, type Board, type Difficulty, type LeaderEntry } from "../lib/scores";
import { useTitle } from "../lib/useTitle";

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function prettyIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function Leaderboard() {
  useTitle("Leaderboards");
  const [games, setGames] = useState<Game[]>(FALLBACK_GAMES);
  const [mode, setMode] = useState<string>(FALLBACK_GAMES[0].mode);
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  const [scopeKey, setScopeKey] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("common");
  const [date, setDate] = useState<string>(isoToday()); // for the daily board
  const [board, setBoard] = useState<Board>({ entries: [], scope_label: "", date: null });
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(false);

  const activeGame = games.find((g) => g.mode === mode) ?? games[0];
  const isDaily = !!activeGame?.is_daily;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Free-play needs a scope; daily derives it server-side from the date.
    if (!isDaily && !scopeKey) return;
    let live = true;
    setLoading(true);
    fetchLeaderboard(mode, isDaily ? "" : (scopeKey ?? ""), difficulty, isDaily ? date : undefined).then(
      (b) => {
        if (!live) return;
        setBoard(b);
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [mode, scopeKey, difficulty, date, isDaily]);

  const atToday = date >= isoToday();

  return (
    <div className="min-h-screen w-screen px-4 py-8">
      <LeafBackground density={20} />
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <TopBar />

        <h1 className="font-hand text-5xl font-bold text-clade-ink">Leaderboards</h1>

        <div className="flex flex-wrap items-center gap-3">
          {/* Game dropdown */}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="rounded-full border-2 border-clade-ink/25 bg-clade-paper px-4 py-1.5 font-mono text-sm text-clade-ink/80 outline-none transition hover:border-clade-ink/50"
          >
            {games.map((g) => (
              <option key={g.mode} value={g.mode}>
                {g.label}
              </option>
            ))}
          </select>

          {isDaily ? (
            <DateNav
              label={prettyIso(date)}
              onPrev={() => setDate((d) => shiftIso(d, -1))}
              onNext={() => setDate((d) => shiftIso(d, 1))}
              atToday={atToday}
            />
          ) : (
            <ScopePicker
              scopes={scopes}
              value={scopeKey ? scopeKey.split("+") : []}
              onChange={(keys) =>
                // Mixed boards share the game's scope mixing: a sorted '+'-joined key, so the
                // order picked doesn't matter (matches the server's canonical board).
                setScopeKey(keys.length ? [...keys].sort().join("+") : null)
              }
            />
          )}

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

        {/* Which board you're looking at */}
        {board.scope_label && (
          <p className="-mt-2 font-mono text-[11px] uppercase tracking-widest text-clade-ink/40">
            {board.scope_label}
            {isDaily ? ` · ${prettyIso(date)}` : ""}
          </p>
        )}

        <section className="ink-card bg-clade-paper px-6 py-5">
          {loading ? (
            <p className="font-mono text-xs text-clade-ink/40">Loading…</p>
          ) : board.entries.length === 0 ? (
            <p className="font-mono text-sm text-clade-ink/45">
              {isDaily ? "No one's played this day yet." : "No runs on this board yet — be the first."}
            </p>
          ) : (
            <ol className="space-y-0.5">
              {board.entries.map((e: LeaderEntry) => {
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

function DateNav({
  label,
  onPrev,
  onNext,
  atToday,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  atToday: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onPrev} className="pill px-3" aria-label="Previous day">
        ◀
      </button>
      <span className="min-w-[6.5rem] text-center font-mono text-sm text-clade-ink/80">{label}</span>
      <button
        type="button"
        onClick={onNext}
        disabled={atToday}
        className="pill px-3 disabled:opacity-30"
        aria-label="Next day"
      >
        ▶
      </button>
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
