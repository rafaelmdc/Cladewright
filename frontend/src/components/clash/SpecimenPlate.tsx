// A specimen plate for Clade Clash (#36) — the card's whole visual weight.
//
// This replaces the old CardThumb arrangement (a 72px square floating above a 24px Caveat
// name), which had the hierarchy upside down: in a game about RECOGNISING an animal, the
// animal is the evidence and the name is the caption. So the art goes full-bleed at 4:3 and
// the name drops to a caption band under it, like a field-guide plate.
//
// Two other deliberate choices:
//   • the binomial is set in Space Mono, not italic Caveat — a binomial is *data*, and the
//     handwriting face is for the name a person would actually say;
//   • the image comes from the summary's `big` (originalimage), because the thumbnail is a
//     ~200px render and looks soft once it fills a card.
//
// Falls back to a hatched paper panel when a species has no art at all, so a plate is always
// the same shape — the old component collapsed to nothing, which made cards jump around.
//
// Hovering a plate opens a zoom (#143): the full picture, uncropped, plus the Wikipedia lead
// once the round is over. See PlateZoom.

import { useCallback, useEffect, useRef, useState } from "react";

import { commonNameOf } from "../../lib/game/commonName";
import { fetchWikiSummary, type WikiSummary } from "../../lib/wiki";
import type { NameLens } from "../../lib/game/settings";
import { PlateZoom } from "./PlateZoom";

export function SpecimenPlate({
  common,
  sci,
  lens,
  compact,
  zoom = true,
  spoil = false,
}: {
  common: string;
  sci: string;
  lens: NameLens;
  /** The centre specimen is a touch smaller than the two options it sits between. */
  compact?: boolean;
  /** Set false to suppress the hover zoom (e.g. on a card that's mid-animation). */
  zoom?: boolean;
  /** True once the round is revealed — only then may the zoom show the Wikipedia text, which
   *  states the animal's family and would otherwise hand over the answer. */
  spoil?: boolean;
}) {
  const [wiki, setWiki] = useState<WikiSummary | null | undefined>(undefined); // undefined=loading
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const [fallback, setFallback] = useState<string | null>(null); // the plain thumbnail
  const [hover, setHover] = useState(false);
  const plateRef = useRef<HTMLDivElement>(null);
  // The panel is a portal beside the plate, so the pointer crosses a gap to reach it. A short
  // grace period lets it, instead of the panel vanishing the moment you go for it.
  const closeTimer = useRef<number | undefined>(undefined);
  const setHovering = useCallback((over: boolean) => {
    window.clearTimeout(closeTimer.current);
    if (over) setHover(true);
    else closeTimer.current = window.setTimeout(() => setHover(false), 140);
  }, []);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    setWiki(undefined);
    setFallback(null);
    // Scientific name first (precise taxon article), then the common name as a fallback.
    fetchWikiSummary([sci, common]).then((w) => {
      if (!alive) return;
      setWiki(w);
      setSrc(w?.big ?? w?.thumbnail ?? null);
      setFallback(w?.big && w.thumbnail && w.big !== w.thumbnail ? w.thumbnail : null);
    });
    return () => {
      alive = false;
    };
  }, [common, sci]);

  // Under the scientific lens the common name is withheld entirely — that's the hard mode.
  // Everywhere else, `common` may be the binomial the pipeline fell back to when the species
  // has no vernacular (#145); showing that as the headline (in handwriting, no less) and then
  // AGAIN as the mono subtitle read as a bug. Set it as the binomial it is, once.
  const vernacular = lens === "scientific" ? null : commonNameOf({ common, sci });
  const primary = vernacular ?? sci;
  const isSci = vernacular === null;
  const secondary = lens === "both" && vernacular ? sci : null;

  return (
    <div
      ref={plateRef}
      className="relative w-full overflow-hidden"
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      <div className={`relative w-full overflow-hidden bg-clade-ink/[0.06] ${compact ? "aspect-[4/3]" : "aspect-[4/3]"}`}>
        {src && (
          <img
            src={src}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            /* Decorative: the name below already carries the meaning, and under the
               scientific lens an alt of the common name would leak the answer. */
            onError={() => {
              // Wikimedia's accepted thumbnail widths are theirs to change; if the card-sized
              // URL ever stops resolving, drop to the summary's own thumbnail rather than
              // showing a broken-image icon. Then give up and use the hatched panel.
              if (fallback) {
                setSrc(fallback);
                setFallback(null);
              } else {
                setSrc(null);
              }
            }}
          />
        )}
        {src === undefined && <div className="h-full w-full animate-pulse bg-clade-ink/[0.08]" />}
        {src === null && (
          <div
            className="h-full w-full"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, transparent 0 7px, rgb(var(--clade-ink) / 5%) 7px 14px)",
            }}
          />
        )}
        {/* A quiet affordance — the zoom is discoverable without shouting over the specimen. */}
        {zoom && src && (
          <span
            className={`pointer-events-none absolute bottom-1.5 right-1.5 rounded-full bg-clade-ink/50 px-1.5 py-0.5 font-mono text-[10px] leading-none text-clade-paper transition-opacity ${
              hover ? "opacity-100" : "opacity-0"
            }`}
          >
            ⌕
          </span>
        )}
      </div>
      <div className="border-t-2 border-clade-ink/10 px-3 py-2 text-left">
        <div
          className={`font-hand text-[1.35rem] font-bold leading-tight text-clade-ink ${isSci ? "italic" : ""}`}
        >
          {primary}
        </div>
        {secondary && (
          <div className="font-mono text-[0.66rem] leading-snug text-clade-ink/45">{secondary}</div>
        )}
      </div>

      {zoom && hover && (
        <PlateZoom
          title={primary}
          sub={secondary}
          image={src ?? null}
          wiki={wiki}
          spoil={spoil}
          anchor={plateRef.current}
          onHoverChange={setHovering}
        />
      )}
    </div>
  );
}
