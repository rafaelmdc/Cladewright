// Optional "How to play" tour. A guided carousel that mixes two kinds of step:
//   • mechanic steps — an animated mini-tree (TourTree) explaining how the game itself works
//     (placing names, clades, scoring), since the real board isn't on the hub; and
//   • spotlight steps — it dims the page and punches a pulsing hole around a real hub control
//     (difficulty, clades, daily) so the player sees exactly what each setting is.
// Opt-in only (launched from a hub link); Esc or "Skip" closes it. Steps are data-driven so
// the tour can grow with the site (GitHub issue #59).

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useState } from "react";

import { TourTree } from "./TourTree";
import type { TourStep } from "./tourSteps";

const DIM = "rgb(var(--clade-ink))";
const ACCENT = "rgb(var(--clade-accent))";
const PAD = 10; // padding around a spotlighted element

/** Live bounding rect of the current spotlight anchor (or null for mechanic steps). Scrolls
 *  the element into view and keeps the rect fresh across scroll/resize. */
function useAnchorRect(anchor: string | undefined, step: number): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!anchor) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    const settle = setTimeout(measure, 380); // re-measure once the smooth scroll lands
    let raf = 0;
    const onMove = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      clearTimeout(settle);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [anchor, step]);
  return rect;
}

export function OnboardingTour({
  open,
  onClose,
  steps,
}: {
  open: boolean;
  onClose: () => void;
  steps: TourStep[];
}) {
  const [i, setI] = useState(0);
  // Guard the index against shorter step sets / stale renders.
  const idx = Math.min(i, steps.length - 1);
  const step = steps[idx];
  const rect = useAnchorRect(open ? step.anchor : undefined, idx);
  const last = idx === steps.length - 1;

  // Reset to the first step whenever the tour is (re)opened.
  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, steps.length]);

  if (!open) return null;

  const next = () => (last ? onClose() : setI((n) => n + 1));

  // Spotlight card hugs its anchor; mechanic card is centered.
  const cardStyle: React.CSSProperties = {};
  if (rect) {
    const W = 320;
    const below = rect.bottom < window.innerHeight * 0.5;
    cardStyle.left = Math.min(Math.max(rect.left + rect.width / 2 - W / 2, 12), window.innerWidth - W - 12);
    if (below) cardStyle.top = rect.bottom + 18;
    else cardStyle.bottom = window.innerHeight - rect.top + 18;
  }

  return (
    <div className="fixed inset-0 z-[70]">
      {/* Dim layer — uniform, or with a punched hole around the spotlighted control. The SVG
          captures clicks so the page underneath stays inert during the tour. */}
      <svg className="absolute inset-0 h-full w-full" onClick={() => {}}>
        <defs>
          <mask id="tour-spot">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - PAD}
                y={rect.top - PAD}
                width={rect.width + PAD * 2}
                height={rect.height + PAD * 2}
                rx={14}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill={DIM} fillOpacity={0.55} mask="url(#tour-spot)" />
        {rect && (
          <motion.rect
            x={rect.left - PAD}
            y={rect.top - PAD}
            width={rect.width + PAD * 2}
            height={rect.height + PAD * 2}
            rx={14}
            fill="none"
            stroke={ACCENT}
            strokeWidth={2.5}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
        )}
      </svg>

      {/* The step card. */}
      <div
        className={rect ? "absolute w-80" : "absolute inset-0 flex items-center justify-center px-4"}
        style={rect ? cardStyle : undefined}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
            className={`ink-card bg-clade-paper p-5 shadow-xl ${rect ? "" : "w-full max-w-md"}`}
          >
            {step.variant && (
              <div className="mb-3 rounded-xl border border-clade-ink/10 bg-clade-bg/40 p-2">
                <TourTree variant={step.variant} />
              </div>
            )}
            <h3 className="font-hand text-3xl font-bold leading-none text-clade-ink">{step.title}</h3>
            <p className="mt-2 font-mono text-[13px] leading-relaxed text-clade-ink/70">{step.body}</p>

            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {steps.map((_, n) => (
                  <button
                    key={n}
                    aria-label={`Step ${n + 1}`}
                    onClick={() => setI(n)}
                    className={`h-1.5 rounded-full transition-all ${
                      n === idx ? "w-4 bg-clade-accent" : "w-1.5 bg-clade-ink/25 hover:bg-clade-ink/45"
                    }`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                {idx > 0 && (
                  <button
                    onClick={() => setI((n) => n - 1)}
                    className="font-mono text-xs uppercase tracking-widest text-clade-ink/45 hover:text-clade-ink"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={next}
                  className="rounded-full border-2 border-clade-ink/80 bg-clade-paper px-4 py-1.5 font-hand text-lg text-clade-ink transition hover:border-clade-accent"
                >
                  {last ? "Got it" : "Next →"}
                </button>
              </div>
            </div>

            <button
              onClick={onClose}
              className="mt-3 block w-full text-center font-mono text-[10px] uppercase tracking-widest text-clade-ink/35 hover:text-clade-ink/70"
            >
              Skip tour
            </button>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
