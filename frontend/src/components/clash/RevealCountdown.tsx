// The wait between the reveal and the next round, made visible (#144).
//
// The reveal is where Clade Clash actually teaches — it draws the round's topology and names
// the clade the answer shares. It used to vanish after a couple of seconds with no warning,
// so the board changed while you were still reading it. The linger is longer now, and this
// says how much of it is left: a bare number would answer "how long" but not "how long out of
// what", so it's a draining ring with the seconds inside — the same countdown language as the
// round timer above the board — plus a way to skip ahead for anyone who reads faster.

import { useEffect, useState } from "react";

export function RevealCountdown({
  ms,
  onSkip,
  waiting,
}: {
  ms: number;
  /** Omitted where the SERVER owns the clock (versus) — there is nothing to skip. */
  onSkip?: () => void;
  waiting?: boolean;
}) {
  const [left, setLeft] = useState(ms);
  useEffect(() => {
    const started = performance.now();
    const id = window.setInterval(() => {
      setLeft(Math.max(0, ms - (performance.now() - started)));
    }, 100);
    return () => window.clearInterval(id);
  }, [ms]);

  const frac = left / ms;
  const R = 9;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-2">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden className="-rotate-90">
        <circle cx="12" cy="12" r={R} fill="none" stroke="rgb(var(--clade-ink) / 15%)" strokeWidth="2.5" />
        <circle
          cx="12"
          cy="12"
          r={R}
          fill="none"
          stroke="rgb(var(--clade-accent))"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
        />
      </svg>
      <span className="tabular-nums">
        {waiting ? "dealing…" : `next round in ${Math.ceil(left / 1000)}s`}
      </span>
      {onSkip && (
      <button
        type="button"
        onClick={onSkip}
        className="rounded-full border border-clade-ink/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-clade-ink/50 transition hover:border-clade-accent hover:text-clade-ink"
      >
        next →
      </button>
      )}
    </div>
  );
}

