// Landing hub — pick a mode. See docs/examples/homepage.png for the intended look.
import { Link } from "react-router-dom";

export function Hub() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-5xl font-semibold leading-tight">
        Guess your way across the tree of life.
      </h1>
      <p className="mt-3 text-lg text-clade-ink/70">
        One daily puzzle, two ways to play. Pick a mode.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <ModeCard
          to="/marathon"
          title="Marathon"
          blurb="Name as many organisms as you can against the clock — each lands on a living tree you build. Empty branches show how many sisters stay hidden."
        />
        <ModeCard
          to="/classic"
          title="Classic"
          blurb="Guess the mystery animal. Each wrong guess reveals the nearest shared ancestor. Limited guesses."
        />
      </div>
    </main>
  );
}

function ModeCard({ to, title, blurb }: { to: string; title: string; blurb: string }) {
  return (
    <Link
      to={to}
      className="block rounded-2xl border border-clade-ink/15 bg-white/40 p-6 transition hover:border-clade-ink/40"
    >
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2 text-clade-ink/70">{blurb}</p>
    </Link>
  );
}
