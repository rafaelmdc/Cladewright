// A small theme switcher for the TopBar: a palette button that opens a popover of the
// available themes (Notebook / High contrast / Dark). High contrast + Dark exist because the
// default creams can wash out to white on dim or low-quality panels.

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { applyTheme, getTheme, THEME_LABELS, THEMES, type Theme } from "../lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Reflect whatever the pre-paint inline script (or another tab) set.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Theme"
        aria-label="Change theme"
        className="grid h-9 w-9 place-items-center rounded-full border-2 border-clade-ink/25 text-clade-ink/70 transition hover:border-clade-accent hover:text-clade-ink"
      >
        <PaletteIcon />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute right-0 top-full z-40 mt-1.5 w-44 origin-top-right overflow-hidden rounded-2xl border-2 border-clade-ink/80 bg-clade-paper p-1.5 shadow-xl"
          >
            {THEMES.map((t) => {
              const active = t === theme;
              return (
                <li key={t} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => {
                      setTheme(t);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left font-mono text-sm transition ${
                      active
                        ? "bg-clade-accent text-clade-paper"
                        : "text-clade-ink hover:bg-clade-accentSoft/60"
                    }`}
                  >
                    <span>{THEME_LABELS[t]}</span>
                    <Swatch theme={t} active={active} />
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

/** Three dots previewing a theme's bg / ink / accent, so the choice reads at a glance. */
function Swatch({ theme, active }: { theme: Theme; active: boolean }) {
  // Mirror index.css (kept tiny — just enough to preview). hex per theme.
  const c: Record<Theme, [string, string, string]> = {
    notebook: ["#ece7db", "#262219", "#3f6b4c"],
    contrast: ["#ffffff", "#11100c", "#165a30"],
    dark: ["#1a1814", "#ece7db", "#7cad89"],
  };
  const [bg, ink, accent] = c[theme];
  return (
    <span className={`flex shrink-0 items-center gap-0.5 ${active ? "opacity-90" : ""}`}>
      {[bg, ink, accent].map((col, i) => (
        <span
          key={i}
          className="h-3 w-3 rounded-full ring-1 ring-clade-ink/20"
          style={{ backgroundColor: col }}
        />
      ))}
    </span>
  );
}

function PaletteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.012 17.5 2 12 2z" />
    </svg>
  );
}
