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
                    <ModeCard key={m.game} stat={m} />
                  ))}
                </div>
              )}
            </section>

            {stats.totals.games_played > 0 && (
              <section className="ink-card bg-clade-paper px-6 py-5">
                <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">
                  Activity
                </h2>
                <ActivityHeatmap
                  activity={stats.activity}
                  days={stats.heatmap_days}
                  games={stats.modes.map((m) => ({ game: m.game, label: m.label }))}
                />
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
  key: string; // YYYY-MM-DD
  date: Date;
  idx: number; // position in the flat, non-future day list (for range selection)
}
/** A day's value under the current game filter. */
interface DayValue {
  value: number; // plays (All) or best score (single game)
  plays: number;
  best: number;
  has: boolean;
  dateLabel: string; // "Mon, Jun 16"
  breakdown: { label: string; games: number }[]; // per-game plays (for the All tooltip)
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HEAT_FILL = [
  "bg-clade-ink/[0.06]", // 0 — no games
  "bg-clade-accent/30",
  "bg-clade-accent/50",
  "bg-clade-accent/75",
  "bg-clade-accent",
];

/** Interactive GitHub-style activity heatmap with game-toggle chips. ONE heatmap for all
 * games; the chips filter it and the shading adapts: "All" shades by plays/day (activity
 * aggregates across games), a single game shades by that game's best score/day (now
 * comparable). Click a day or drag a range to select; a comparison bar plot of the
 * selected days appears below. Columns are weeks (Sun→Sat); month labels on top, weekday
 * labels on the left. See docs/games-model.md. Dependency-free. */
function ActivityHeatmap({
  activity,
  days,
  games,
}: {
  activity: DayActivity[];
  days: number;
  games: { game: string; label: string }[];
}) {
  const labelOf = new Map(games.map((g) => [g.game, g.label]));
  // With a single game, default to it (shade by score); with several, default to All.
  const [filter, setFilter] = useState<string>(games.length === 1 ? games[0].game : "all");
  const single = filter !== "all";

  // Group activity rows by date, then aggregate per day under the active filter.
  const byDate = new Map<string, DayActivity[]>();
  for (const a of activity) {
    const list = byDate.get(a.date);
    if (list) list.push(a);
    else byDate.set(a.date, [a]);
  }
  const fmtDay = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  function dayValue(key: string, date: Date): DayValue {
    const dateLabel = fmtDay(date);
    const rows = (byDate.get(key) ?? []).filter((e) => filter === "all" || e.game === filter);
    if (rows.length === 0)
      return { value: 0, plays: 0, best: 0, has: false, dateLabel, breakdown: [] };
    const plays = rows.reduce((s, e) => s + e.games, 0);
    const best = Math.max(...rows.map((e) => e.best));
    const breakdown = rows.map((e) => ({ label: labelOf.get(e.game) ?? e.game, games: e.games }));
    return { value: single ? best : plays, plays, best, has: true, dateLabel, breakdown };
  }

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
        col.push({ key: fmtKey(date), date, idx: idx++ } as Cell);
        flat.push(col[col.length - 1] as Cell);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(col);
  }

  // Scale: max day-value under the current filter.
  let vmax = 1;
  for (const cell of flat) vmax = Math.max(vmax, dayValue(cell.key, cell.date).value);
  const level = (v: number) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / vmax) * 4)));

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
  const selected = flat
    .slice(lo, hi + 1)
    .map((c) => ({ key: c.key, date: c.date, v: dayValue(c.key, c.date) }));

  // Hover tooltip card (cursor-following), replacing the plain title text.
  const [hover, setHover] = useState<{ dv: DayValue; x: number; y: number } | null>(null);

  return (
    <div className="select-none">
      {games.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <HeatChip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </HeatChip>
          {games.map((g) => (
            <HeatChip key={g.game} active={filter === g.game} onClick={() => setFilter(g.game)}>
              {g.label}
            </HeatChip>
          ))}
        </div>
      )}
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
                {col.map((cell, di) => {
                  if (cell === null) return <div key={di} className="h-3 w-3" />;
                  const dv = dayValue(cell.key, cell.date);
                  return (
                    <div
                      key={cell.key}
                      onMouseDown={() => {
                        dragging.current = true;
                        setSel({ a: cell.idx, b: cell.idx });
                      }}
                      onMouseEnter={() => {
                        if (dragging.current) setSel((s) => ({ a: s.a, b: cell.idx }));
                      }}
                      onMouseMove={(e) => setHover({ dv, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHover(null)}
                      className={`h-3 w-3 cursor-pointer rounded-[3px] ${HEAT_FILL[level(dv.value)]} ${
                        cell.idx >= lo && cell.idx <= hi ? "ring-1 ring-clade-ink/55" : ""
                      }`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between pl-8 font-mono text-[10px] text-clade-ink/45">
          <span>{single ? "shaded by best score · " : "shaded by plays · "}click or drag ↓</span>
          <span className="flex items-center gap-1.5">
            less
            {HEAT_FILL.map((f, i) => (
              <span key={i} className={`h-3 w-3 rounded-[3px] ${f}`} />
            ))}
            more
          </span>
        </div>
      </div>

      <SelectionSummary items={selected} vmax={vmax} single={single} />
      {hover && <HeatTooltip dv={hover.dv} x={hover.x} y={hover.y} single={single} />}
    </div>
  );
}

/** Cursor-following hover card for a heatmap day — clean field-notebook panel, not a plain
 * browser tooltip. Shows the date and, by filter, the day's score/plays (with a per-game
 * breakdown in All mode). */
function HeatTooltip({ dv, x, y, single }: { dv: DayValue; x: number; y: number; single: boolean }) {
  return (
    <div
      className="pointer-events-none fixed z-50 w-44 rounded-lg border border-clade-ink/15 bg-clade-paper/95 px-3 py-2 shadow-lg backdrop-blur"
      style={{ left: Math.min(x + 14, window.innerWidth - 190), top: y + 14 }}
    >
      <p className="font-hand text-lg leading-none text-clade-ink">{dv.dateLabel}</p>
      {!dv.has ? (
        <p className="mt-1 font-mono text-[11px] text-clade-ink/45">No games</p>
      ) : single ? (
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-hand text-3xl font-bold leading-none text-clade-accent">
            {dv.best}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-clade-ink/45">
            best · {dv.plays} play{dv.plays > 1 ? "s" : ""}
          </span>
        </div>
      ) : (
        <div className="mt-1.5">
          <p className="font-mono text-[11px] text-clade-ink/60">
            {dv.plays} play{dv.plays > 1 ? "s" : ""}
          </p>
          <ul className="mt-1 space-y-0.5">
            {dv.breakdown.map((b) => (
              <li key={b.label} className="flex justify-between font-mono text-[10px] text-clade-ink/50">
                <span className="truncate">{b.label}</span>
                <span className="ml-2 text-clade-ink/70">{b.games}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-clade-paper/70 px-3 py-2 text-center">
      <div className="font-hand text-2xl font-bold leading-none text-clade-ink">{value}</div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-clade-ink/45">
        {label}
      </div>
    </div>
  );
}

function HeatChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] transition ${
        active
          ? "bg-clade-ink text-clade-bg"
          : "border border-clade-ink/20 text-clade-ink/60 hover:border-clade-ink/40 hover:text-clade-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** Summary card for the days selected on the heatmap: a header (range + count), a few
 * adaptive stat cells, and a comparison bar plot. The metric follows the active filter —
 * best score (single game) or plays (All). Styled as a panel, matching the rest of the UI. */
function SelectionSummary({
  items,
  vmax,
  single,
}: {
  items: { key: string; date: Date; v: DayValue }[];
  vmax: number;
  single: boolean;
}) {
  if (items.length === 0) return null;
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const showLabels = items.length <= 16;
  const first = items[0].date;
  const last = items[items.length - 1].date;
  const range = items.length === 1 ? fmt(first) : `${fmt(first)} – ${fmt(last)}`;

  const active = items.filter((it) => it.v.has);
  const totalPlays = items.reduce((s, it) => s + it.v.plays, 0);
  const bestMax = active.length ? Math.max(...active.map((it) => it.v.best)) : 0;
  const avgBest = active.length
    ? Math.round(active.reduce((s, it) => s + it.v.best, 0) / active.length)
    : 0;
  const busiest = items.reduce((m, it) => Math.max(m, it.v.plays), 0);

  return (
    <div className="mt-4 rounded-xl border border-clade-ink/10 bg-clade-bg/40 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="font-hand text-xl text-clade-ink">{range}</p>
        <p className="font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">
          {items.length} day{items.length > 1 ? "s" : ""} · {single ? "best score" : "plays"}
        </p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        {single ? (
          <>
            <MiniStat label="Best" value={bestMax} />
            <MiniStat label="Avg best" value={avgBest} />
            <MiniStat label="Days played" value={`${active.length}/${items.length}`} />
          </>
        ) : (
          <>
            <MiniStat label="Plays" value={totalPlays} />
            <MiniStat label="Busiest day" value={busiest} />
            <MiniStat label="Active days" value={`${active.length}/${items.length}`} />
          </>
        )}
      </div>

      <div className="flex h-24 items-end gap-1">
        {items.map((it) => {
          const v = it.v.value;
          const pct = (v / vmax) * 100;
          return (
            <div
              key={it.key}
              className="flex h-full min-w-[6px] max-w-[2rem] flex-1 flex-col justify-end"
            >
              {showLabels && (
                <span className="mb-0.5 text-center font-mono text-[9px] leading-none text-clade-ink/45">
                  {v || ""}
                </span>
              )}
              <div
                className={`w-full rounded-t-sm ${v ? "bg-clade-accent" : "bg-clade-ink/15"}`}
                style={{ height: `max(${pct}%, 2px)` }}
              />
              {showLabels && (
                <span className="mt-1 text-center font-mono text-[8px] leading-none text-clade-ink/35">
                  {it.date.getMonth() + 1}/{it.date.getDate()}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
