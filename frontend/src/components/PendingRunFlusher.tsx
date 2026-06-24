// Auto-saves the run a logged-out player finished just before signing in. Signing in is a
// top-level OAuth redirect, so the run can't be submitted inline — GameOverCard stashes it
// (see lib/scores stashPendingRun) and this global component, mounted once in App, submits
// it after the player lands back authenticated and confirms it with a small toast.
// See GitHub issue #78.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { fetchMe } from "../lib/auth";
import { submitRun, takePendingRun, type SubmitResult } from "../lib/scores";

type Toast =
  | { kind: "saved"; result: SubmitResult; ranked: boolean; scopeLabel: string }
  | { kind: "error" };

export function PendingRunFlusher() {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      // Cheap exit: only touch the network when something was actually stashed.
      const run = takePendingRun();
      if (!run) return;
      const me = await fetchMe();
      if (!live) return;
      if (!me.authenticated) return; // sign-in didn't complete — nothing to save against
      const outcome = await submitRun(run.payload);
      if (!live) return;
      setToast(
        outcome.ok
          ? { kind: "saved", result: outcome.result, ranked: run.payload.ranked, scopeLabel: run.scopeLabel }
          : { kind: "error" },
      );
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!toast) return null;

  return (
    <div className="fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div className="ink-card flex items-center gap-4 bg-clade-paper px-5 py-3">
        <div className="text-left">{renderToast(toast)}</div>
        <button
          onClick={() => setToast(null)}
          aria-label="Dismiss"
          className="font-mono text-xs uppercase tracking-widest text-clade-ink/40 hover:text-clade-ink"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function renderToast(toast: Toast) {
  if (toast.kind === "error") {
    return <p className="font-mono text-xs text-clade-ink/60">Couldn't save your last run.</p>;
  }
  const { result, ranked, scopeLabel } = toast;
  if (ranked && result.rank != null) {
    return (
      <p className="font-hand text-xl text-clade-accent">
        Saved your last run — rank #{result.rank}
        <Link
          to="/leaderboard"
          className="ml-2 align-middle font-mono text-[11px] text-clade-ink/45 hover:text-clade-ink"
        >
          view board →
        </Link>
      </p>
    );
  }
  return (
    <p className="font-hand text-lg text-clade-ink/75">
      Saved your last run{scopeLabel ? ` · ${scopeLabel}` : ""} to your stats
    </p>
  );
}
