// The end-of-run screen: final tally, score submission (server re-scored), the
// leaderboard for this scope, and a sign-in prompt when the player isn't logged in.
// All network side-effects live here so Marathon's render stays about gameplay.

import { useEffect, useState } from "react";

import { fetchMe, GOOGLE_LOGIN_URL, type Me } from "../lib/auth";
import { fetchLeaderboard, submitRun, type LeaderEntry, type SubmitOutcome } from "../lib/scores";

const MODE = "marathon_free";

export function GameOverCard({
  count,
  score,
  scope,
  scopeLabel,
  assetVersion,
  ranked,
  transcript,
  onPlayAgain,
}: {
  count: number;
  score: number;
  scope: string;
  scopeLabel: string;
  assetVersion: number;
  ranked: boolean;
  transcript: string[];
  onPlayAgain: () => void;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [submit, setSubmit] = useState<SubmitOutcome | null>(null);
  const [board, setBoard] = useState<LeaderEntry[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await fetchMe();
      if (!live) return;
      setMe(who);
      // Only ranked runs (default modifiers) count — submit first so the board includes
      // this run, then load the board.
      if (ranked && who.authenticated && transcript.length > 0) {
        const outcome = await submitRun({ mode: MODE, scope, asset_version: assetVersion, transcript });
        if (!live) return;
        setSubmit(outcome);
      }
      const entries = await fetchLeaderboard(MODE, scope);
      if (live) setBoard(entries);
    })();
    return () => {
      live = false;
    };
    // Run once per mounted game-over card (transcript/scope are fixed for this run).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ink-card flex max-h-[85vh] w-[28rem] max-w-[90vw] flex-col items-center overflow-hidden bg-clade-paper px-8 py-7 text-center">
      <h2 className="font-hand text-6xl font-bold text-clade-ink">Time!</h2>
      <p className="mt-1 font-mono text-sm text-clade-ink/60">
        {count} placed · {score} points · {scopeLabel}
      </p>

      <div className="mt-4 w-full">
        {ranked ? (
          renderSubmitStatus(me, submit)
        ) : (
          <p className="font-mono text-xs text-clade-ink/50">
            Custom settings — this run isn't ranked.
          </p>
        )}
      </div>

      <Leaderboard board={board} label={scopeLabel} me={me} />

      <button onClick={onPlayAgain} className="btn-play mt-6">
        ▶ Play again
      </button>
    </div>
  );
}

function renderSubmitStatus(me: Me | null, submit: SubmitOutcome | null) {
  if (me === null) return <p className="font-mono text-xs text-clade-ink/40">Checking…</p>;

  if (!me.authenticated) {
    return (
      <a
        href={GOOGLE_LOGIN_URL}
        className="inline-flex items-center gap-2 rounded-full border-2 border-clade-ink/80 bg-clade-paper px-4 py-1.5 font-hand text-xl text-clade-ink transition hover:border-clade-accent"
      >
        Sign in with Google to save your score
      </a>
    );
  }
  if (submit?.ok) {
    return (
      <p className="font-hand text-2xl text-clade-accent">
        Saved — rank #{submit.result.rank}
      </p>
    );
  }
  if (submit && !submit.ok) {
    return <p className="font-mono text-xs text-clade-ink/50">Couldn't save this run.</p>;
  }
  return <p className="font-mono text-xs text-clade-ink/40">Saving…</p>;
}

function Leaderboard({ board, label, me }: { board: LeaderEntry[]; label: string; me: Me | null }) {
  return (
    <div className="mt-5 w-full text-left">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">
        {label} leaderboard
      </p>
      {board.length === 0 ? (
        <p className="font-mono text-xs text-clade-ink/40">No runs yet — be the first.</p>
      ) : (
        <ol className="max-h-52 space-y-0.5 overflow-auto">
          {board.map((e) => {
            const mine = me?.authenticated && e.user === me.username;
            return (
              <li
                key={`${e.rank}-${e.user}`}
                className={`flex items-baseline justify-between rounded-lg px-2.5 py-1 ${
                  mine ? "bg-clade-accentSoft/70" : ""
                }`}
              >
                <span className="flex items-baseline gap-2 truncate">
                  <span className="w-5 shrink-0 font-mono text-xs text-clade-ink/45">{e.rank}</span>
                  <span className="truncate font-hand text-lg text-clade-ink">{e.user}</span>
                </span>
                <span className="font-mono text-sm text-clade-ink/70">{e.score}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
