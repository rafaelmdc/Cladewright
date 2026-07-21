// Hover a Clade Clash plate to look closer (#143).
//
// The card art is cropped to 4:3 and about 200px wide — enough to say "a brown fish", not
// enough to actually LOOK at the animal, which is the entire skill the game asks for. So
// hovering opens the uncropped picture at a readable size, with the Wikipedia lead underneath,
// the way Time Attack's NodeCard does for a placed species.
//
// One deliberate difference from NodeCard: **the text is withheld until the round is over.**
// A species' lead paragraph is almost always "…is a species of X in the family Y", which is
// the answer, verbatim. Showing it mid-round would turn a recognition game into a reading
// game, so during play the zoom is the picture only — and says so, rather than looking broken.
//
// Rendered through a portal because every ancestor (the plate, the card) clips its overflow,
// and this is meant to escape the card.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { WikiSummary } from "../../lib/wiki";

const W = 380; // panel width
const GAP = 12; // from the plate's edge
const PAD = 8; // from the viewport's edge

export function PlateZoom({
  title,
  sub,
  image,
  wiki,
  spoil,
  anchor,
  onHoverChange,
}: {
  title: string;
  sub: string | null;
  image: string | null;
  wiki: WikiSummary | null | undefined;
  /** Round over — the blurb is safe to show. */
  spoil: boolean;
  /** The plate being zoomed; the panel is placed beside it. */
  anchor: HTMLElement | null;
  /** Keeps the panel open while the pointer is on the panel itself. */
  onHoverChange: (over: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 320;
      const clampX = (x: number) => Math.max(PAD, Math.min(x, window.innerWidth - W - PAD));
      const clampY = (y: number) => Math.max(PAD, Math.min(y, window.innerHeight - h - PAD));
      const cx = r.left + r.width / 2;
      const mid = window.innerWidth / 2;

      // The three cards sit side by side, so a panel must not open over its neighbours — you
      // are comparing them. An outer card opens AWAY from the middle; the centre specimen has
      // a neighbour on both sides, so it opens downward instead.
      if (Math.abs(cx - mid) < window.innerWidth * 0.12) {
        setPos({ left: clampX(cx - W / 2), top: clampY(r.bottom + GAP) });
        return;
      }
      // Clamp rather than flip when the margin is narrower than the panel: sliding until it
      // fits overlaps the card you are already looking at, which costs nothing, while flipping
      // would throw it across the board and cover the other two.
      const left = cx < mid ? r.left - GAP - W : r.right + GAP;
      setPos({ left: clampX(left), top: clampY(r.top) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, wiki, spoil]);

  // Escape closes it, for anyone who ends up with a stuck panel (pointerleave can be missed
  // when the card underneath re-renders between rounds).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onHoverChange(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onHoverChange]);

  return createPortal(
    <div
      ref={ref}
      onPointerEnter={() => onHoverChange(true)}
      onPointerLeave={() => onHoverChange(false)}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: W }}
      className="fixed z-50 overflow-hidden rounded-xl border-2 border-clade-ink/25 bg-clade-paper shadow-2xl"
    >
      {image ? (
        <div className="max-h-64 w-full overflow-y-auto bg-clade-ink/5">
          {/* full width, natural height — a tall portrait scrolls rather than being cropped */}
          <img src={image} alt="" draggable={false} className="block w-full" />
        </div>
      ) : (
        <div
          className="h-24 w-full"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent 0 7px, rgb(var(--clade-ink) / 5%) 7px 14px)",
          }}
        />
      )}

      <div className="p-3">
        <p className="font-hand text-xl font-bold leading-tight text-clade-ink">{title}</p>
        {sub && <p className="font-mono text-[0.66rem] text-clade-ink/45">{sub}</p>}

        <div className="mt-2 max-h-40 overflow-y-auto pr-1 text-sm leading-snug text-clade-ink/75">
          {!spoil ? (
            <p className="font-mono text-[11px] leading-relaxed text-clade-ink/40">
              The write-up names the family — it'd hand you the answer. It opens after the reveal.
            </p>
          ) : wiki === undefined ? (
            <span className="text-clade-ink/40">Looking it up…</span>
          ) : wiki === null ? (
            <span className="text-clade-ink/40">No Wikipedia article found.</span>
          ) : (
            <p>{wiki.extract}</p>
          )}
        </div>

        {spoil && wiki && (
          <a
            href={wiki.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-sm font-medium text-clade-accent hover:underline"
          >
            Read on Wikipedia →
          </a>
        )}
      </div>
    </div>,
    document.body,
  );
}
