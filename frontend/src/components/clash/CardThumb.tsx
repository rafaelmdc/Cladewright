// A small species thumbnail for Clade Clash cards (#36). Reuses the cached Wikipedia summary
// fetch (lib/wiki) the Time Attack node card already uses — so a thumbnail seen once is free
// everywhere after. Collapses to nothing when a species has no image, so cards without art
// stay clean rather than showing a broken box.

import { useEffect, useState } from "react";

import { fetchWikiSummary } from "../../lib/wiki";

export function CardThumb({ common, sci, size = 72 }: { common: string; sci: string; size?: number }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined); // undefined=loading, null=none

  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    // Scientific name first (precise taxon article), then the common name as a fallback.
    fetchWikiSummary([sci, common]).then((w) => {
      if (alive) setSrc(w?.thumbnail ?? null);
    });
    return () => {
      alive = false;
    };
  }, [common, sci]);

  if (src === null) return null; // no image — don't reserve space

  return (
    <div
      className="mx-auto mb-1 overflow-hidden rounded-lg bg-clade-ink/5 ring-1 ring-inset ring-clade-ink/10"
      style={{ width: size, height: size }}
    >
      {src && <img src={src} alt={common} loading="lazy" className="h-full w-full object-cover" />}
    </div>
  );
}
