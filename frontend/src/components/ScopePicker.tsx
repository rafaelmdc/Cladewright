// The scope selector — pick which slices of the tree of life to play (Mammals, Birds,
// Fish, …). MULTI-SELECT: scopes are toggles, so a run can mix several at once (their
// blobs merge into one tree client-side — see lib/asset/merge.ts). A field-notebook
// dropdown (inked border, Caveat label, mono counts) to match the rest of the HUD. A
// "remote" scope (too big to download) is tagged and not mixable — picking it replaces
// the selection.

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import type { ScopeInfo } from "../lib/asset/scopes";

export function ScopePicker({
  scopes,
  value,
  onChange,
  multiple = true,
}: {
  scopes: ScopeInfo[];
  /** currently-selected scope keys (one or many) */
  value: string[];
  onChange: (keys: string[]) => void;
  /** false = single-select (replace + close), e.g. the leaderboard filter */
  multiple?: boolean;
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
  const selected = scopes.filter((s) => value.includes(s.key));
  const totalTips = selected.reduce((n, s) => n + s.tip_count, 0);
  const label =
    selected.length === 0
      ? "Choose clades"
      : selected.length === 1
        ? selected[0].label
        : `${selected.length} clades`;

  function toggle(s: ScopeInfo) {
    // Single-select (leaderboard filter), or a remote scope (not mergeable): replace the
    // whole selection and close.
    if (!multiple || s.mode === "remote") {
      onChange([s.key]);
      setOpen(false);
      return;
    }
    const blobValue = value.filter((k) => scopes.find((x) => x.key === k)?.mode !== "remote");
    const has = blobValue.includes(s.key);
    // Never let the selection become empty — toggling the last one off is a no-op.
    const next = has ? blobValue.filter((k) => k !== s.key) : [...blobValue, s.key];
    if (next.length > 0) onChange(next);
  }

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
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="font-mono text-[11px] text-clade-ink/45">
            {totalTips.toLocaleString()}
          </span>
        )}
        <Chevron open={open} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-multiselectable
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute left-0 top-full z-40 mt-1.5 max-h-[60vh] w-60 origin-top overflow-auto rounded-[18px] border-2 border-clade-ink/80 bg-clade-paper p-1.5 shadow-xl"
          >
            {scopes.map((s) => {
              const on = value.includes(s.key);
              return (
                <li key={s.key} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => toggle(s)}
                    className={`flex w-full items-baseline justify-between gap-2 rounded-xl px-3 py-1.5 text-left transition ${
                      on
                        ? "bg-clade-accent text-clade-paper"
                        : "text-clade-ink hover:bg-clade-accentSoft/60"
                    }`}
                  >
                    <span className="flex items-baseline gap-2">
                      {multiple && (
                        <span aria-hidden className="font-mono text-xs">
                          {on ? "☑" : "☐"}
                        </span>
                      )}
                      <span className="font-hand text-xl leading-none">{s.label}</span>
                      {s.mode === "remote" && (
                        <span
                          className={`rounded-full px-1.5 py-px font-mono text-[9px] uppercase tracking-wide ${
                            on ? "bg-clade-paper/25" : "bg-clade-note text-clade-ink/70"
                          }`}
                        >
                          streamed
                        </span>
                      )}
                    </span>
                    <span
                      className={`font-mono text-[11px] ${on ? "text-clade-paper/70" : "text-clade-ink/45"}`}
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
