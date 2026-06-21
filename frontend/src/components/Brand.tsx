// Brand chrome shared across pages: the leaf wordmark and the mode nav. Matches
// docs/examples/ — Caveat wordmark + mono nav pills, active mode filled ink.

import { Link, useLocation } from "react-router-dom";

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
  return (
    <Link to="/" className="flex items-center gap-2 text-clade-ink" aria-label="Cladewright home">
      <LeafMark className="h-7 w-7 text-clade-accent" />
      <span className={`font-hand font-bold leading-none ${size}`}>Cladewright</span>
    </Link>
  );
}

const NAV = [
  { to: "/", label: "Hub" },
  { to: "/classic", label: "1 · Classic" },
  { to: "/marathon", label: "2 · Marathon" },
];

export function TopNav() {
  const { pathname } = useLocation();
  return (
    <nav className="flex items-center gap-2">
      {NAV.map((n) => (
        <Link key={n.to} to={n.to} className={`pill ${pathname === n.to ? "pill-active" : ""}`}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function TopBar({ className = "" }: { className?: string }) {
  return (
    <header className={`flex items-center justify-between gap-4 ${className}`}>
      <Wordmark />
      <TopNav />
    </header>
  );
}
