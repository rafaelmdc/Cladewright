// "End game" control — a small square icon button (peer of the settings gear, top-right)
// that ends the run early so the player banks their score without waiting out the timer.
// Ending forfeits the remaining clock, so a one-tap confirm popover guards against a
// misclick. On confirm it calls onEnd, which drives the same game-over flow as the timer
// reaching zero (re-score + submit + GameOverCard).

import { useState } from "react";

export function EndGameButton({ onEnd }: { onEnd: () => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="pointer-events-auto absolute right-16 top-4 z-30">
      <button
        type="button"
        aria-label="End game"
        title="End game"
        onClick={() => setConfirming((c) => !c)}
        className={`grid h-9 w-9 place-items-center rounded-lg border bg-white/70 backdrop-blur transition ${
          confirming
            ? "border-clade-ink/40 text-clade-ink"
            : "border-clade-ink/15 text-clade-ink/70 hover:border-clade-ink/40"
        }`}
      >
        <FlagIcon />
      </button>

      {confirming && (
        <>
          {/* click-away to dismiss without ending */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setConfirming(false)}
            className="fixed inset-0 -z-10 cursor-default"
          />
          <div className="absolute right-0 top-11 w-56 rounded-xl border border-clade-ink/15 bg-clade-paper/95 p-3 shadow-lg backdrop-blur">
            <p className="font-hand text-xl leading-snug text-clade-ink">End the run now?</p>
            <p className="mb-3 font-mono text-[11px] leading-snug text-clade-ink/55">
              You keep your score — the timer just stops here.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-lg px-2.5 py-1 font-mono text-xs text-clade-ink/55 hover:text-clade-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  onEnd();
                }}
                className="rounded-lg bg-clade-ink px-3 py-1 font-mono text-xs text-clade-bg transition hover:bg-clade-accent"
              >
                End game
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FlagIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 21V4" />
      <path d="M5 4h11l-1.6 3.5L16 11H5" />
    </svg>
  );
}
