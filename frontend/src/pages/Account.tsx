// Account page: per-game-mode stats (sessions, total + unique animals named, best),
// a recent-sessions score graph, and account deletion. Structured per game mode, so
// Classic/future games appear as extra cards with no page changes.

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Wordmark } from "../components/Brand";
import { LeafBackground } from "../components/LeafBackground";
import {
  fetchAccountStats,
  deleteAccount,
  type AccountStats,
  type DayActivity,
  type ModeStat,
} from "../lib/account";
import { logout } from "../lib/auth";
import { useTitle } from "../lib/useTitle";

export function Account() {
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  useTitle("Account");

  useEffect(() => {
    fetchAccountStats().then((s) => {
      setStats(s);
      setLoading(false);
    });
  }, []);

  async function onDelete() {
    if (await deleteAccount()) navigate("/");
  }

  async function onLogout() {
    await logout();
    navigate("/");
  }

  return (
    <div className="min-h-screen w-screen px-4 py-8">
      <LeafBackground density={20} />
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <Link to="/">
            <Wordmark size="text-2xl" />
          </Link>
          <div className="flex items-center gap-4">
            {stats && (
              <button
                onClick={onLogout}
                className="font-mono text-xs uppercase tracking-widest text-clade-ink/50 hover:text-clade-ink"
              >
                Sign out
              </button>
            )}
            <Link to="/" className="font-mono text-xs uppercase tracking-widest text-clade-ink/50 hover:text-clade-ink">
              ← back
            </Link>
          </div>
        </header>

        {loading ? (
          <p className="font-mono text-sm text-clade-ink/50">Loading…</p>
        ) : !stats ? (
          <SignedOut />
        ) : (
          <>
            <section className="ink-card bg-clade-paper px-6 py-5">
              <h1 className="font-hand text-4xl font-bold text-clade-ink">{stats.user.username}</h1>
              <p className="mt-0.5 font-mono text-xs text-clade-ink/50">
                {stats.user.email} · naturalist since {stats.user.joined}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <BigStat label="Sessions" value={stats.totals.games_played} />
                <BigStat label="Animals named" value={stats.totals.total_named} />
                <BigStat label="Unique species" value={stats.totals.unique_named} />
              </div>
            </section>

            <section>
              <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">
                By game
              </h2>
              {stats.modes.length === 0 ? (
                <p className="font-mono text-sm text-clade-ink/45">
                  No games played yet — go place some organisms.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {stats.modes.map((m) => (
                    <ModeCard key={m.mode} stat={m} />
                  ))}
                </div>
              )}
            </section>

            {stats.totals.games_played > 0 && (
              <section className="ink-card bg-clade-paper px-6 py-5">
                <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">
                  Activity · best score per day
                </h2>
                <ActivityHeatmap activity={stats.activity} days={stats.heatmap_days} />
              </section>
            )}

            <section className="rounded-[20px] border-2 border-red-700/30 bg-red-50/40 px-6 py-5">
              <h2 className="font-hand text-2xl text-red-800">Danger zone</h2>
              <p className="mt-1 font-mono text-xs text-clade-ink/55">
                Deleting your account removes all your runs, stats, and named species. This can't be undone.
              </p>
              {!confirming ? (
                <button
                  onClick={() => setConfirming(true)}
                  className="mt-3 rounded-full border-2 border-red-700/50 px-4 py-1.5 font-hand text-lg text-red-800 transition hover:bg-red-700 hover:text-white"
                >
                  Delete account
                </button>
              ) : (
                <div className="mt-3 flex items-center gap-3">
                  <span className="font-hand text-lg text-clade-ink">Are you sure?</span>
                  <button
                    onClick={onDelete}
                    className="rounded-full bg-red-700 px-4 py-1.5 font-hand text-lg text-white transition hover:bg-red-800"
                  >
                    Yes, delete everything
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="font-mono text-xs uppercase tracking-widest text-clade-ink/50 hover:text-clade-ink"
                  >
                    cancel
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function SignedOut() {
  return (
    <div className="ink-card flex flex-col items-center gap-3 bg-clade-paper px-8 py-10 text-center">
      <p className="font-hand text-2xl text-clade-ink">You're not signed in.</p>
      <Link
        to="/login"
        className="rounded-full border-2 border-clade-ink/80 bg-clade-paper px-4 py-1.5 font-hand text-xl text-clade-ink transition hover:border-clade-accent"
      >
        Sign in
      </Link>
    </div>
  );
}

function BigStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-clade-ink/10 bg-clade-bg/40 px-3 py-2 text-center">
      <div className="font-hand text-3xl font-bold text-clade-ink">{value.toLocaleString()}</div>
      <div className="font-mono text-[9px] uppercase tracking-widest text-clade-ink/45">{label}</div>
    </div>
  );
}

function ModeCard({ stat }: { stat: ModeStat }) {
  const rows: [string, number][] = [
    ["Sessions", stat.games_played],
    ["Animals named", stat.total_named],
    ["Unique species", stat.unique_named],
    ["Best score", stat.best_score],
  ];
  return (
    <div className="ink-card bg-clade-paper px-5 py-4">
      <h3 className="font-hand text-2xl text-clade-ink">{stat.label}</h3>
      <dl className="mt-2 space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between">
            <dt className="font-mono text-[11px] uppercase tracking-wide text-clade-ink/45">{k}</dt>
            <dd className="font-hand text-xl text-clade-ink">{v.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

interface Cell {
  key: string;
  date: Date;
  act?: DayActivity;
  idx: number; // position in the flat, non-future day list (for range selection)
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HEAT_FILL = [
  "bg-clade-ink/[0.06]", // 0 — no games
  "bg-clade-accent/30",
  "bg-clade-accent/50",
  "bg-clade-accent/75",
  "bg-clade-accent",
];

/** GitHub-style activity heatmap, but interactive: one square per day over the last ~13
 * weeks, shaded by best score that day. CLICK a day or DRAG across a range to select it;
 * a comparison bar plot of the selected days' scores appears below. Hover shows the
 * date + score. Columns are weeks (Sun→Sat); month labels run along the top, weekday
 * labels down the left. Dependency-free. */
function ActivityHeatmap({ activity, days }: { activity: DayActivity[]; days: number }) {
  const byDate = new Map(activity.map((a) => [a.date, a]));
  const maxBest = Math.max(1, ...activity.map((a) => a.best));

  const fmtKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  start.setDate(start.getDate() - start.getDay()); // rewind to Sunday → whole-week columns

  // Build week-columns (Cell | null; null = a future slot) and a flat ordered day list.
  const weeks: (Cell | null)[][] = [];
  const colSundays: Date[] = [];
  const flat: Cell[] = [];
  const cursor = new Date(start);
  let idx = 0;
  while (cursor <= today) {
    colSundays.push(new Date(cursor));
    const col: (Cell | null)[] = [];
    for (let d = 0; d < 7; d++) {
      if (cursor > today) {
        col.push(null);
      } else {
        const date = new Date(cursor);
        const cell: Cell = { key: fmtKey(date), date, act: byDate.get(fmtKey(date)), idx: idx++ };
        col.push(cell);
        flat.push(cell);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(col);
  }

  // Month labels: one per column, shown when the column's Sunday opens a new month.
  let lastMonth = -1;
  const monthLabels = colSundays.map((d) => {
    if (d.getMonth() !== lastMonth) {
      lastMonth = d.getMonth();
      return MONTHS[d.getMonth()];
    }
    return "";
  });

  // Selection: a range over the flat day list. Default to the most recent week.
  const [sel, setSel] = useState<{ a: number; b: number }>(() => ({
    a: Math.max(0, flat.length - 7),
    b: Math.max(0, flat.length - 1),
  }));
  const dragging = useRef(false);
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  const lo = Math.min(sel.a, sel.b);
  const hi = Math.max(sel.a, sel.b);
  const selected = flat.slice(lo, hi + 1);

  const level = (best: number) => Math.min(4, Math.ceil((best / maxBest) * 4));

  return (
    <div className="select-none">
      <div className="overflow-x-auto">
        {/* month labels */}
        <div className="flex gap-[3px] pl-8">
          {monthLabels.map((m, i) => (
            <div key={i} className="w-3 font-mono text-[10px] text-clade-ink/45">
              {m}
            </div>
          ))}
        </div>
        <div className="flex">
          {/* weekday labels (Mon/Wed/Fri, like GitHub) */}
          <div className="mr-1 flex w-7 flex-col gap-[3px] pt-[1px]">
            {["", "Mon", "", "Wed", "", "Fri", ""].map((w, i) => (
              <div key={i} className="h-3 font-mono text-[9px] leading-3 text-clade-ink/40">
                {w}
              </div>
            ))}
          </div>
          {/* the grid */}
          <div className="flex gap-[3px]">
            {weeks.map((col, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {col.map((cell, di) =>
                  cell === null ? (
                    <div key={di} className="h-3 w-3" />
                  ) : (
                    <div
                      key={cell.key}
                      onMouseDown={() => {
                        dragging.current = true;
                        setSel({ a: cell.idx, b: cell.idx });
                      }}
                      onMouseEnter={() => {
                        if (dragging.current) setSel((s) => ({ a: s.a, b: cell.idx }));
                      }}
                      title={`${cell.date.toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })} · ${cell.act ? `best ${cell.act.best} · ${cell.act.games} game${cell.act.games > 1 ? "s" : ""}` : "no games"}`}
                      className={`h-3 w-3 cursor-pointer rounded-[3px] ${
                        HEAT_FILL[cell.act ? level(cell.act.best) : 0]
                      } ${cell.idx >= lo && cell.idx <= hi ? "ring-1 ring-clade-ink/55" : ""}`}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between pl-8 font-mono text-[10px] text-clade-ink/45">
          <span>click or drag days to compare ↓</span>
          <span className="flex items-center gap-1.5">
            less
            {HEAT_FILL.map((f, i) => (
              <span key={i} className={`h-3 w-3 rounded-[3px] ${f}`} />
            ))}
            more
          </span>
        </div>
      </div>

      <SelectionBars cells={selected} maxBest={maxBest} />
    </div>
  );
}

/** Comparison bar plot of the days currently selected on the heatmap. Best score per day;
 * no-game days show as a faint nub so gaps read. Date + score labels appear when few. */
function SelectionBars({ cells, maxBest }: { cells: Cell[]; maxBest: number }) {
  if (cells.length === 0) return null;
  const showLabels = cells.length <= 16;
  const first = cells[0].date;
  const last = cells[cells.length - 1].date;
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="mt-4 border-t border-clade-ink/10 pt-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">
        {cells.length === 1 ? fmt(first) : `${fmt(first)} – ${fmt(last)}`} · {cells.length} day
        {cells.length > 1 ? "s" : ""}
      </p>
      <div className="flex h-24 items-end gap-1">
        {cells.map((c) => {
          const best = c.act?.best ?? 0;
          const pct = (best / maxBest) * 100;
          return (
            <div
              key={c.key}
              title={`${c.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${c.act ? `best ${best} · ${c.act.games} game${c.act.games > 1 ? "s" : ""}` : "no games"}`}
              className="flex h-full min-w-[6px] max-w-[2rem] flex-1 flex-col justify-end"
            >
              {showLabels && (
                <span className="mb-0.5 text-center font-mono text-[9px] leading-none text-clade-ink/45">
                  {best || ""}
                </span>
              )}
              <div
                className={`w-full rounded-t-sm ${best ? "bg-clade-accent" : "bg-clade-ink/15"}`}
                style={{ height: `max(${pct}%, 2px)` }}
              />
              {showLabels && (
                <span className="mt-1 text-center font-mono text-[8px] leading-none text-clade-ink/35">
                  {c.date.getMonth() + 1}/{c.date.getDate()}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
