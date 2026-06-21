// The scope selector — pick which slice of the tree of life to play (Mammals, Birds,
// Fish, …). A field-notebook dropdown (inked border, Caveat label, mono counts) rather
// than a native <select>, to match the rest of the HUD. A "remote" scope (too big to
// download) is tagged so the player knows it streams.

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import type { ScopeInfo } from "../lib/asset/scopes";

export function ScopePicker({
  scopes,
  value,
  onChange,
}: {
  scopes: ScopeInfo[];
  value: string | null;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (scopes.length === 0) return null;
  const current = scopes.find((s) => s.key === value);

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Scope"
        className="flex items-center gap-2 rounded-2xl border-2 border-clade-ink/80 bg-clade-paper/90 px-3.5 py-1.5 font-hand text-2xl leading-none text-clade-ink shadow-sm backdrop-blur transition hover:border-clade-accent focus:border-clade-accent focus:outline-none"
      >
        <span>{current?.label ?? "Choose a clade"}</span>
        {current && (
          <span className="font-mono text-[11px] text-clade-ink/45">
            {current.tip_count.toLocaleString()}
          </span>
        )}
        <Chevron open={open} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute left-0 top-full z-40 mt-1.5 max-h-[60vh] w-60 origin-top overflow-auto rounded-[18px] border-2 border-clade-ink/80 bg-clade-paper p-1.5 shadow-xl"
          >
            {scopes.map((s) => {
              const selected = s.key === value;
              return (
                <li key={s.key} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(s.key);
                      setOpen(false);
                    }}
                    className={`flex w-full items-baseline justify-between gap-2 rounded-xl px-3 py-1.5 text-left transition ${
                      selected
                        ? "bg-clade-accent text-clade-paper"
                        : "text-clade-ink hover:bg-clade-accentSoft/60"
                    }`}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="font-hand text-xl leading-none">{s.label}</span>
                      {s.mode === "remote" && (
                        <span
                          className={`rounded-full px-1.5 py-px font-mono text-[9px] uppercase tracking-wide ${
                            selected ? "bg-clade-paper/25" : "bg-clade-note text-clade-ink/70"
                          }`}
                        >
                          streamed
                        </span>
                      )}
                    </span>
                    <span
                      className={`font-mono text-[11px] ${selected ? "text-clade-paper/70" : "text-clade-ink/45"}`}
                    >
                      {s.tip_count.toLocaleString()}
                    </span>
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <motion.svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-clade-ink/50"
      animate={{ rotate: open ? 180 : 0 }}
      transition={{ duration: 0.15 }}
    >
      <path d="M6 9l6 6 6-6" />
    </motion.svg>
  );
}
