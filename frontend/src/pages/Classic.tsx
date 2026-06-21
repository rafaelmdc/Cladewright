// Classic — Metazooa-style daily (Phase 5). Rides on the same asset + TreeRenderer +
// autocomplete as Marathon. One mystery animal/day (server-authoritative seed); each
// guess places the MRCA of guess + answer and warms a proximity bar; limited guesses.
// See docs/examples/metazooa_copy.png. Placeholder until Phase 5.
import { LeafMark, TopBar } from "../components/Brand";
import { LeafBackground } from "../components/LeafBackground";

export function Classic() {
  return (
    <div className="min-h-screen">
      <LeafBackground density={22} />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <TopBar />

        <div className="mt-20 flex flex-col items-center text-center">
          <LeafMark className="h-12 w-12 text-clade-accent/70" />
          <h1 className="mt-4 font-hand text-7xl font-bold text-clade-ink">Classic</h1>
          <p className="mt-3 max-w-md font-hand text-2xl text-clade-ink/65">
            Guess the mystery animal — each wrong guess reveals the nearest shared ancestor.
          </p>
          <span className="mt-6 pill cursor-default border-dashed">coming soon</span>
        </div>
      </div>
    </div>
  );
}
