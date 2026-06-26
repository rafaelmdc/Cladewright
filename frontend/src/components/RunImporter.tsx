// After signing in, offer to import the runs played while signed OUT (#107). GameOverCard
// caches each such run for 5 min (lib/scores cacheRun); this global component — mounted once in
// App — checks the cache on load and, if the player is now authenticated, shows a popup asking
// whether to add them to their profile. Confirm → bulk-submit; decline → clear. Supersedes the
// single-run auto-flush of #78 (signing in "to save your score" now lands here too).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { fetchMe } from "../lib/auth";
import { clearCachedRuns, peekCachedRuns, submitRun, type CachedRun } from "../lib/scores";

export function RunImporter() {
  // Runs awaiting a decision (the popup); null = no prompt showing.
  const [pending, setPending] = useState<CachedRun[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ saved: number } | "error" | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      // Cheap exit: only hit the network when something was actually cached.
      const cached = peekCachedRuns();
      if (cached.length === 0) return;
      const me = await fetchMe();
      if (!live) return;
      if (!me.authenticated) return; // offer only once they're signed in
      setPending(cached);
    })();
    return () => {
      live = false;
    };
  }, []);

  async function importAll() {
    if (!pending) return;
    setBusy(true);
    let saved = 0;
    for (const run of pending) {
      const outcome = await submitRun(run.payload);
      if (outcome.ok) saved += 1;
    }
    clearCachedRuns();
    setPending(null);
    setBusy(false);
    setResult(saved > 0 ? { saved } : "error");
  }

  function decline() {
    clearCachedRuns();
    setPending(null);
  }

  if (!pending && !result) return null;

  return (
    <div className="fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div className="ink-card flex items-center gap-4 bg-clade-paper px-5 py-3">
        {pending ? (
          <>
            <p className="font-hand text-lg text-clade-ink/85">
              Add{" "}
              <span className="font-bold text-clade-ink">
                {pending.length} run{pending.length === 1 ? "" : "s"}
              </span>{" "}
              you played while signed out to your profile?
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={importAll}
                disabled={busy}
                className="rounded-full border-2 border-clade-ink/80 bg-clade-paper px-3.5 py-1 font-hand text-lg text-clade-ink transition hover:border-clade-accent disabled:opacity-50"
              >
                {busy ? "Adding…" : "Add"}
              </button>
              <button
                onClick={decline}
                disabled={busy}
                className="font-mono text-[11px] uppercase tracking-widest text-clade-ink/40 hover:text-clade-ink disabled:opacity-50"
              >
                No thanks
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-left">{renderResult(result!)}</div>
            <button
              onClick={() => setResult(null)}
              aria-label="Dismiss"
              className="font-mono text-xs uppercase tracking-widest text-clade-ink/40 hover:text-clade-ink"
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function renderResult(result: { saved: number } | "error") {
  if (result === "error") {
    return <p className="font-mono text-xs text-clade-ink/60">Couldn't add those runs.</p>;
  }
  return (
    <p className="font-hand text-lg text-clade-ink/80">
      Added {result.saved} run{result.saved === 1 ? "" : "s"} to your profile
      <Link
        to="/account"
        className="ml-2 align-middle font-mono text-[11px] text-clade-ink/45 hover:text-clade-ink"
      >
        view →
      </Link>
    </p>
  );
}
