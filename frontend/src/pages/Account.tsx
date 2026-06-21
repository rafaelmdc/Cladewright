// Account page: per-game-mode stats (sessions, total + unique animals named, best),
// a recent-sessions score graph, and account deletion. Structured per game mode, so
// Classic/future games appear as extra cards with no page changes.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Wordmark } from "../components/Brand";
import { fetchAccountStats, deleteAccount, type AccountStats, type ModeStat } from "../lib/account";
import { logout } from "../lib/auth";

export function Account() {
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();

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
    <div className="min-h-screen w-screen bg-clade-bg px-4 py-8">
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

            {stats.recent_runs.length > 0 && (
              <section className="ink-card bg-clade-paper px-6 py-5">
                <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">
                  Recent sessions · score
                </h2>
                <ScoreBars runs={[...stats.recent_runs].reverse()} />
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

/** Tiny dependency-free SVG bar chart of recent session scores (chronological). */
function ScoreBars({ runs }: { runs: { score: number }[] }) {
  const max = Math.max(1, ...runs.map((r) => r.score));
  const W = 100;
  const H = 36;
  const gap = 1.5;
  const bw = (W - gap * (runs.length - 1)) / runs.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" preserveAspectRatio="none">
      {runs.map((r, i) => {
        const h = (r.score / max) * (H - 2);
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={H - h}
            width={bw}
            height={h}
            rx={0.6}
            className="fill-clade-accent"
          />
        );
      })}
    </svg>
  );
}
