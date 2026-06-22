// Brand chrome shared across pages: the leaf wordmark and the mode nav. Matches
// docs/examples/ — Caveat wordmark + mono nav pills, active mode filled ink.

import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { LEAF_HOLD_MS, toggleLeafFlee } from "../lib/leafEgg";
import { AuthChip } from "./AuthChip";
import { ThemeToggle } from "./ThemeToggle";

export function LeafMark({ className = "h-7 w-7" }: { className?: string }) {
  // A small two-frond sprig, echoing the falling leaves.
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path
        d="M16 28 C16 18 11 11 4 8 C7 16 9 22 16 28 Z"
        fill="currentColor"
        opacity="0.85"
      />
      <path
        d="M16 28 C16 16 20 9 28 6 C25 15 23 22 16 28 Z"
        fill="currentColor"
      />
      <path d="M16 30 V15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ size = "text-3xl" }: { size?: string }) {
  // Secret: press-and-HOLD the leaf for 5s to toggle the "spooked leaves" easter egg. A quick
  // click is left alone (still navigates home); only a completed hold suppresses that click.
  const holdTimer = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const startHold = () => {
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      const on = toggleLeafFlee();
      suppressClick.current = true; // the release click shouldn't navigate
      setToast(on ? "ragebait enabled" : "ragebait disabled");
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 1800);
    }, LEAF_HOLD_MS);
  };
  const endHold = () => window.clearTimeout(holdTimer.current);

  return (
    <Link to="/" className="flex items-center gap-2 text-clade-ink" aria-label="Cladewright home">
      <span
        className="relative cursor-pointer select-none"
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        onClick={(e) => {
          if (suppressClick.current) {
            e.preventDefault();
            e.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        <LeafMark className="h-7 w-7 text-clade-accent" />
        {toast && (
          <span className="pointer-events-none absolute left-0 top-full mt-1 whitespace-nowrap rounded-full border border-clade-ink/15 bg-clade-paper/95 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-clade-accent shadow-sm">
            {toast}
          </span>
        )}
      </span>
      <span className={`font-hand font-bold leading-none ${size}`}>Cladewright</span>
    </Link>
  );
}

export function TopBar({ className = "" }: { className?: string }) {
  return (
    <header className={`flex items-center justify-between gap-4 ${className}`}>
      <Wordmark />
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <AuthChip />
      </div>
    </header>
  );
}
