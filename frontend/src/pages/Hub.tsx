// Landing hub — pick a mode. Mirrors docs/examples/homepage.png: leaf wordmark + nav,
// a big handwritten headline, two mode cards with play buttons, difficulty pills, all
// over the drifting-leaf background.
import { Link } from "react-router-dom";

import { LeafMark, TopBar } from "../components/Brand";
import { LeafBackground } from "../components/LeafBackground";
import { useTitle } from "../lib/useTitle";

export function Hub() {
  useTitle();
  return (
    <div className="min-h-screen">
      <LeafBackground density={30} />
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
        <TopBar />

        <div className="flex flex-1 flex-col items-center justify-center gap-6 pb-16">
          <p className="text-center font-mono text-xs uppercase tracking-wider text-clade-ink/45">
            data: Catalogue of Life · every taxon shown common + scientific
          </p>

          <div className="w-full max-w-2xl">
            <ModeCard
              to="/marathon"
              title="Marathon"
              blurb="Name as many organisms as you can against the clock — each one lands on a living tree you build. Empty branches show how many sisters stay hidden. Zoom in to hunt them."
              meta="grow the tree"
            />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <span className="font-mono text-xs uppercase tracking-wider text-clade-ink/45">
              Difficulty
            </span>
            <span className="pill pill-active cursor-default">Common names</span>
            <span className="pill cursor-default border-dashed">Scientific only</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeCard({
  to,
  title,
  blurb,
  meta,
  tag,
}: {
  to: string;
  title: string;
  blurb: string;
  meta: string;
  tag?: string;
}) {
  return (
    <div className="ink-card flex flex-col p-6">
      <LeafMark className="h-8 w-8 text-clade-accent" />
      <div className="mt-3 flex items-center gap-2">
        <h2 className="font-hand text-5xl font-bold leading-none text-clade-ink">{title}</h2>
        {tag && (
          <span className="rounded-full bg-clade-ink px-2 py-0.5 font-mono text-[10px] tracking-wider text-clade-bg">
            {tag}
          </span>
        )}
      </div>
      <p className="mt-3 font-hand text-2xl leading-snug text-clade-ink/70">{blurb}</p>
      <div className="mt-auto flex items-center justify-between pt-5">
        <Link to={to} className="btn-play">
          ▶ Play
        </Link>
        <span className="font-mono text-xs text-clade-ink/45">{meta}</span>
      </div>
    </div>
  );
}
