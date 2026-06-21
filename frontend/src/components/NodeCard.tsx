// NodeCard — the learn/deduce surface. Hovering any node on the tree (a species OR a
// clade) peeks a card; clicking the pin keeps it. Pinned cards are draggable, and you
// can keep as many open as you like. Names, rank, lineage and traits come straight from
// the baked asset; the Wikipedia image + blurb are fetched lazily and cached.

import { motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { InternedAsset } from "../lib/asset/types";
import { fetchWikiSummary, type WikiSummary } from "../lib/wiki";

interface Props {
  asset: InternedAsset;
  id: string;
  kind: "tip" | "node";
  pinned: boolean;
  /** desired anchor (container-relative px) and the container size, for auto-placement */
  anchorX: number;
  anchorY: number;
  bounds: { w: number; h: number };
  /** element the drag is clamped within */
  dragRef: React.RefObject<HTMLElement | null>;
  onPin: () => void;
  onClose: () => void;
  onHoverChange?: (over: boolean) => void;
}

const CARD_W = 288; // w-72
const PAD = 8; // keep this far from the canvas edges

/** Short ancestor trail (common-or-scientific names), nearest few. */
function lineageTrail(asset: InternedAsset, id: string, kind: "tip" | "node"): string[] {
  const ids: string[] =
    kind === "tip"
      ? (asset.tipById.get(id)?.lineage ?? [])
      : (() => {
          const out: string[] = [];
          let cur = asset.nodeById.get(id)?.parent ?? null;
          while (cur) {
            out.unshift(cur);
            cur = asset.nodeById.get(cur)?.parent ?? null;
          }
          return out;
        })();
  return ids.map((nid) => {
    const n = asset.nodeById.get(nid);
    return n?.common ?? n?.sci ?? nid;
  });
}

export function NodeCard({
  asset,
  id,
  kind,
  pinned,
  anchorX,
  anchorY,
  bounds,
  dragRef,
  onPin,
  onClose,
  onHoverChange,
}: Props) {
  const tip = kind === "tip" ? asset.tipById.get(id) : undefined;
  const node = kind === "node" ? asset.nodeById.get(id) : undefined;
  const sci = tip?.sci ?? node?.sci ?? id;
  const common = tip?.common ?? node?.common ?? null;
  const rank = kind === "tip" ? "species" : (node?.rank ?? "clade");
  const poolCount = node?.pool_count;
  const traits = tip?.traits;
  const trail = lineageTrail(asset, id, kind).slice(-4);

  // undefined = loading, null = no article found, object = loaded
  const [wiki, setWiki] = useState<WikiSummary | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setWiki(undefined);
    fetchWikiSummary([common ?? "", sci]).then((w) => {
      if (alive) setWiki(w);
    });
    return () => {
      alive = false;
    };
  }, [id, common, sci]);

  // Auto-placement: measure the real rendered height and keep the whole card on-screen
  // (this is what fixes bottom-edge clipping, regardless of image/blurb length). Re-runs
  // when content height changes — but stops once the user has dragged the card.
  const ref = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: anchorX + 14,
    top: anchorY,
  });
  useLayoutEffect(() => {
    if (dragged.current) return;
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const right = anchorX + 14 + CARD_W;
    const left = right > bounds.w - PAD ? Math.max(PAD, anchorX - 14 - CARD_W) : anchorX + 14;
    const top = Math.max(PAD, Math.min(anchorY, bounds.h - h - PAD));
    setPos({ left, top });
  }, [anchorX, anchorY, bounds.w, bounds.h, wiki]);

  const tags: string[] = [];
  if (traits?.extinct) tags.push("Extinct");
  for (const b of traits?.biomes ?? []) tags.push(b);
  for (const e of traits?.environment ?? []) if (!tags.includes(e)) tags.push(e);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      drag={pinned}
      dragMomentum={false}
      dragConstraints={dragRef}
      dragElastic={0.05}
      onDragStart={() => {
        dragged.current = true;
      }}
      style={{ left: pos.left, top: pos.top }}
      className={`pointer-events-auto absolute z-20 w-72 overflow-hidden rounded-xl border border-clade-ink/15 bg-clade-bg/95 shadow-xl backdrop-blur ${
        pinned ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerEnter={() => onHoverChange?.(true)}
      onPointerLeave={() => onHoverChange?.(false)}
    >
      {wiki?.thumbnail && (
        <div className="p-2 pb-0">
          <div
            className="h-44 w-full overflow-y-auto rounded-lg border border-clade-ink/15 bg-clade-ink/5"
            // scroll the (often tall) image instead of dragging the whole card
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* full width, natural height — taller images scroll vertically, not cropped */}
            <img
              src={wiki.thumbnail}
              alt={common ?? sci}
              draggable={false}
              className="block w-full"
            />
          </div>
        </div>
      )}

      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">{common ?? sci}</p>
            <p className="truncate text-sm italic text-clade-ink/55">{sci}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={pinned ? onClose : onPin}
              aria-label={pinned ? "Close" : "Pin card"}
              title={pinned ? "Close" : "Pin"}
              className={`grid h-6 w-6 place-items-center rounded-md transition hover:bg-clade-ink/10 ${
                pinned ? "text-clade-ink/45 hover:text-clade-ink" : "text-clade-accent"
              }`}
            >
              {pinned ? "✕" : <PinIcon />}
            </button>
          </div>
        </div>

        <p className="mt-1.5 text-xs uppercase tracking-wide text-clade-ink/45">
          {rank}
          {poolCount != null && ` · ${poolCount} species`}
        </p>

        {trail.length > 0 && (
          <p className="mt-2 text-xs leading-snug text-clade-ink/50">{trail.join(" › ")}</p>
        )}

        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-clade-ink/10 px-2 py-0.5 text-[11px] capitalize text-clade-ink/60"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div
          className="mt-2.5 max-h-36 overflow-y-auto pr-1 text-sm leading-snug text-clade-ink/75"
          // don't let a drag-to-scroll/select inside the blurb move the whole card
          onPointerDown={(e) => e.stopPropagation()}
        >
          {wiki === undefined && <span className="text-clade-ink/40">Looking it up…</span>}
          {wiki === null && (
            <span className="text-clade-ink/40">No Wikipedia article found.</span>
          )}
          {wiki && <p>{wiki.extract}</p>}
        </div>

        {wiki && (
          <a
            href={wiki.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2.5 inline-block text-sm font-medium text-clade-accent hover:underline"
          >
            Read on Wikipedia →
          </a>
        )}
      </div>
    </motion.div>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}
