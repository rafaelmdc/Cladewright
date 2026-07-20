// The "No tree" modifier's board (#101): with the cladogram hidden, what you've named shows as
// a plain scrollable list, centred on the canvas. No spatial memory aid — that's the challenge.
// Newest placement on top, so your latest is always visible without scrolling.

import type { PlacedEntry } from "../lib/game/placedList";

export function PlacedList({ entries }: { entries: PlacedEntry[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 grid place-items-center p-4">
      <div className="ink-card pointer-events-auto flex max-h-[70vh] w-80 max-w-[88vw] flex-col bg-clade-paper/95">
        <div className="border-b-2 border-clade-ink/10 px-5 py-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">
            Named · no tree
          </p>
          <p className="font-hand text-2xl font-bold text-clade-ink">
            {entries.length} placed
          </p>
        </div>
        {entries.length === 0 ? (
          <p className="px-5 py-8 text-center font-hand text-xl text-clade-ink/45">
            Name an animal to begin — you're flying blind.
          </p>
        ) : (
          <ol className="flex-1 overflow-auto px-2 py-2">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex items-baseline gap-2 rounded-lg px-3 py-1.5 odd:bg-clade-accentSoft/25"
              >
                <span className="flex-1 truncate">
                  <span className="font-hand text-lg leading-tight text-clade-ink">{e.primary}</span>
                  {e.secondary && (
                    <span className="ml-1.5 font-mono text-[11px] italic text-clade-ink/45">
                      {e.secondary}
                    </span>
                  )}
                </span>
                {e.kind === "node" && (
                  <span className="shrink-0 rounded-full bg-clade-note px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-clade-ink/55">
                    {e.rank ?? "clade"}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
