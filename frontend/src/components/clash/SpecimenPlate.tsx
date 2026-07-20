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

import { useEffect, useState } from "react";

import { fetchWikiSummary } from "../../lib/wiki";
import type { NameLens } from "../../lib/game/settings";

export function SpecimenPlate({
  common,
  sci,
  lens,
  compact,
}: {
  common: string;
  sci: string;
  lens: NameLens;
  /** The centre specimen is a touch smaller than the two options it sits between. */
  compact?: boolean;
}) {
  const [src, setSrc] = useState<string | null | undefined>(undefined); // undefined=loading
  const [fallback, setFallback] = useState<string | null>(null); // the plain thumbnail

  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    setFallback(null);
    // Scientific name first (precise taxon article), then the common name as a fallback.
    fetchWikiSummary([sci, common]).then((w) => {
      if (!alive) return;
      setSrc(w?.big ?? w?.thumbnail ?? null);
      setFallback(w?.big && w.thumbnail && w.big !== w.thumbnail ? w.thumbnail : null);
    });
    return () => {
      alive = false;
    };
  }, [common, sci]);

  // Under the scientific lens the common name is withheld entirely — that's the hard mode.
  const label = common || sci;
  const primary = lens === "scientific" ? sci : label;
  const secondary = lens === "both" && sci !== primary ? sci : null;

  return (
    <div className="w-full overflow-hidden">
      <div
        className={`relative w-full overflow-hidden bg-clade-ink/[0.06] ${
          compact ? "aspect-[4/3]" : "aspect-[4/3]"
        }`}
      >
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
      </div>
      <div className="border-t-2 border-clade-ink/10 px-3 py-2 text-left">
        <div
          className={`font-hand text-[1.35rem] font-bold leading-tight text-clade-ink ${
            lens === "scientific" ? "italic" : ""
          }`}
        >
          {primary}
        </div>
        {secondary && (
          <div className="font-mono text-[0.66rem] leading-snug text-clade-ink/45">{secondary}</div>
        )}
      </div>
    </div>
  );
}
