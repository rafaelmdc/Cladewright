// Public, shareable result page (#74) at /r#<encoded> — what a shared link opens. The result
// is read straight from the URL hash (see lib/share), so the page renders entirely client-
// side with no server query: nothing about the run is stored or fetched. It's a brag card,
// not the leaderboard, so a self-contained (forgeable) link is the right trade-off.

import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";

import { LeafMark } from "../components/Brand";
import { LeafBackground } from "../components/LeafBackground";
import { ShareResult } from "../components/ShareResult";
import { decodeShare } from "../lib/share";
import { useTitle } from "../lib/useTitle";

export function Result() {
  const { hash } = useLocation();
  const result = useMemo(() => decodeShare(hash), [hash]);
  useTitle(result ? `${result.score} points` : "Result");

  return (
    <div className="relative grid min-h-screen place-items-center px-4">
      <LeafBackground density={24} />

      <Link
        to="/"
        className="absolute left-6 top-6 font-mono text-xs uppercase tracking-widest text-clade-ink/50 hover:text-clade-ink"
      >
        ← cladewright
      </Link>

      {result === null ? (
        <div className="ink-card bg-clade-paper px-8 py-9 text-center">
          <h1 className="font-hand text-4xl font-bold text-clade-ink">No result here</h1>
          <p className="mt-1 font-mono text-xs text-clade-ink/50">This share link looks empty.</p>
          <Link to="/" className="btn-play mt-5 inline-flex">▶ Play</Link>
        </div>
      ) : (
        <div className="ink-card w-full max-w-md bg-clade-paper px-8 py-9 text-center">
          <LeafMark className="mx-auto h-10 w-10 text-clade-accent" />
          <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-clade-ink/45">
            {result.user}
          </p>
          <div className="mt-3 font-hand text-8xl font-bold leading-none text-clade-ink">
            {result.score}
          </div>
          <p className="mt-1 font-hand text-2xl text-clade-accent">points</p>
          <p className="mt-3 font-hand text-xl text-clade-ink/70">
            {result.animals} animals named{result.scope ? ` · ${result.scope}` : ""}
          </p>
          {result.rank != null && (
            <p className="mt-1 font-hand text-2xl text-clade-accent">rank #{result.rank}</p>
          )}

          <div className="mt-6">
            <ShareResult result={result} />
          </div>
          <Link to="/" className="btn-play mt-5 inline-flex">▶ Play your own</Link>
        </div>
      )}
    </div>
  );
}
