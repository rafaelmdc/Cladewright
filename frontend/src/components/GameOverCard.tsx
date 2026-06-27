// The end-of-run screen: final tally, score submission (server re-scored), the
// leaderboard for this scope, and a sign-in prompt when the player isn't logged in.
// All network side-effects live here so Marathon's render stays about gameplay. A scope
// MIX ("aves+mammalia") is a normal scope here — the server re-scores it against each
// component build and ranks it on its own combined board.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { fetchMe, type Me } from "../lib/auth";
import {
  cacheRun,
  fetchLeaderboard,
  submitRun,
  type Difficulty,
  type LeaderEntry,
  type SubmitOutcome,
  type SubmitResult,
} from "../lib/scores";
import type { ShareData } from "../lib/share";
import { formatMultiplier } from "../lib/game/multipliers";
import type { GameSettings } from "../lib/game/settings";
import { ShareResult } from "./ShareResult";

export function GameOverCard({
  mode = "marathon_free",
  count,
  score,
  scope,
  scopeLabel,
  difficulty,
  assetVersion,
  settings,
  modifiers,
  allowReplay = true,
  transcript,
  timings,
  runToken,
  onPlayAgain,
}: {
  mode?: string;
  count: number;
  score: number;
  scope: string;
  scopeLabel: string;
  difficulty: Difficulty;
  assetVersion: number;
  /** The run's gameplay settings + active modifiers — the server resolves the score multiplier
   *  from these (#101); a default setup is 1.0×. */
  settings: GameSettings;
  modifiers: string[];
  allowReplay?: boolean;
  transcript: string[];
  /** Combo timings + signed session token (#77) — threaded through so the server can re-derive
   *  the combo/clade score and verify the run. */
  timings?: number[];
  runToken?: string | null;
  onPlayAgain: () => void;
}) {
  // The submit payload's settings field is an open record; GameSettings has no index signature.
  const settingsRecord = settings as unknown as Record<string, unknown>;
  const [me, setMe] = useState<Me | null>(null);
  const [submit, setSubmit] = useState<SubmitOutcome | null>(null);
  const [board, setBoard] = useState<LeaderEntry[]>([]);
  // Self-contained share payload, built from this run's own data once it's saved — drives the
  // share/save-image controls. No server round-trip: the result lives in the share URL (#74).
  const [shared, setShared] = useState<ShareData | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await fetchMe();
      if (!live) return;
      setMe(who);
      const payload = {
        mode, scope, difficulty, asset_version: assetVersion, transcript,
        timings, run_token: runToken, settings: settingsRecord, modifiers,
      };
      if (who.authenticated && transcript.length > 0) {
        // Signed in: submit now. The server scores it as base × multiplier and places it on the
        // board unless it fails anti-cheat (#101).
        const outcome = await submitRun(payload);
        if (!live) return;
        setSubmit(outcome);
        if (outcome.ok) {
          setShared({
            user: who.display_name || who.username || "a naturalist",
            score: outcome.result.score, // canonical server score
            animals: new Set(transcript.filter((id) => id.startsWith("tip:"))).size,
            scope: scopeLabel,
            difficulty,
            rank: outcome.result.rank,
          });
        }
      } else if (!who.authenticated && transcript.length > 0) {
        // Signed out: cache the run for 5 min so signing in shortly after can offer to import
        // it (#107). Survives the OAuth redirect via localStorage.
        cacheRun({ payload, count, score, scopeLabel });
      }
      const result = await fetchLeaderboard(mode, scope, difficulty);
      if (live) setBoard(result.entries);
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

      <div className="mt-4 w-full">{renderSubmitStatus(me, submit)}</div>

      <Leaderboard board={board} label={`${scopeLabel} · ${difficulty}`} me={me} />

      {shared && (
        <div className="mt-4 w-full">
          <ShareResult result={shared} />
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        {allowReplay && (
          <button onClick={onPlayAgain} className="btn-play">
            ▶ Play again
          </button>
        )}
        <Link
          to="/"
          className={
            allowReplay
              ? "rounded-full border-2 border-clade-ink/30 px-4 py-1.5 font-hand text-xl text-clade-ink/70 transition hover:border-clade-ink/60 hover:text-clade-ink"
              : "btn-play"
          }
        >
          ▶ Menu
        </Link>
      </div>
    </div>
  );
}

function renderSubmitStatus(me: Me | null, submit: SubmitOutcome | null) {
  if (me === null) return <p className="font-mono text-xs text-clade-ink/40">Checking…</p>;

  if (!me.authenticated) {
    // The run is cached for 5 min (#107); signing in now offers to import it on return.
    return (
      <Link
        to="/login"
        className="inline-flex items-center gap-2 rounded-full border-2 border-clade-ink/80 bg-clade-paper px-4 py-1.5 font-hand text-xl text-clade-ink transition hover:border-clade-accent"
      >
        Sign in to save your score
      </Link>
    );
  }
  if (submit?.ok) {
    // Every run is on the board now (#101); only an anti-cheat failure keeps it off.
    if (submit.result.ranked && submit.result.rank != null) {
      return (
        <p className="font-hand text-2xl text-clade-accent">
          Saved — rank #{submit.result.rank}
          {scoreBreakdown(submit.result)}
        </p>
      );
    }
    return (
      <p className="font-hand text-xl text-clade-ink/70">
        Saved to your stats
        {scoreBreakdown(submit.result)}
        <span className="mt-0.5 block font-mono text-[11px] text-clade-ink/45">
          Couldn't verify this run for the leaderboard.
        </span>
      </p>
    );
  }
  if (submit && !submit.ok) {
    return <p className="font-mono text-xs text-clade-ink/50">Couldn't save this run.</p>;
  }
  return <p className="font-mono text-xs text-clade-ink/40">Saving…</p>;
}

/** A subtle "base +combo +clade ×mult = final" line under the saved message — shown when a
 *  bonus was earned OR the run carried a non-1.0 multiplier (modifiers / eased settings, #101). */
function scoreBreakdown(r: SubmitResult) {
  const combo = r.combo_bonus ?? 0;
  const clade = r.clade_bonus ?? 0;
  const mult = r.score_multiplier ?? 1;
  const base = r.base_score ?? r.base ?? r.score;
  if (combo <= 0 && clade <= 0 && mult === 1) return null;
  return (
    <span className="mt-0.5 block font-mono text-[11px] font-normal text-clade-ink/45">
      {r.base ?? base} base
      {combo > 0 ? ` · +${combo} combo` : ""}
      {clade > 0 ? ` · +${clade} clade` : ""}
      {mult !== 1 ? ` · ${formatMultiplier(mult)}` : ""}
      {" = "}
      {r.score}
    </span>
  );
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
                <span className="flex items-baseline gap-1.5 font-mono text-sm text-clade-ink/70">
                  {e.rank === 1 && (
                    <span aria-label="Top score" title="Top score" className="not-italic">
                      👑
                    </span>
                  )}
                  {e.score}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
