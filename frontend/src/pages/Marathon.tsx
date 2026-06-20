// Marathon — the primary game (Phase 3). The tree canvas is the whole UI; a floating
// HUD holds the timer, the single name input (pool-only autocomplete), and the live
// count. Full design: docs/marathon-design.md. Phase 0: wires the asset + trackers to
// the placeholder renderer so the data path is exercised end to end.

import { useEffect, useMemo, useState } from "react";

import { TreeRenderer } from "../components/TreeRenderer";
import { loadAsset } from "../lib/asset/load";
import type { InternedAsset } from "../lib/asset/types";
import { RemainingTracker } from "../lib/game/remaining";
import { addTip, createInducedTree, type InducedTree } from "../lib/tree/induced";

export function Marathon() {
  const [asset, setAsset] = useState<InternedAsset | null>(null);
  const [tree, setTree] = useState<InducedTree>(() => createInducedTree());
  const [, force] = useState(0);

  useEffect(() => {
    loadAsset().then(setAsset).catch(console.error);
  }, []);

  const tracker = useMemo(() => (asset ? new RemainingTracker(asset) : null), [asset]);

  if (!asset || !tracker) return <p className="p-6">Loading the tree…</p>;

  // TODO(phase-3): real HUD (timer + novelty bonus), pool-only autocomplete input,
  // both daily-seeded and free-play modes, server-side score re-validation on finish.
  function placeFirstUnplaced() {
    const next = asset!.raw.tips.find((t) => !tree.tips.includes(t.id));
    if (!next) return;
    addTip(asset!, tree, next.id);
    tracker!.name(next.id);
    setTree({ ...tree });
    force((n) => n + 1);
  }

  return (
    <div className="relative h-screen w-screen">
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center gap-4 p-4">
        <span className="font-mono text-sm text-clade-ink/60">
          {tree.tips.length} on the tree
        </span>
        <button
          onClick={placeFirstUnplaced}
          className="rounded-lg bg-clade-accent px-3 py-1.5 text-sm text-white"
        >
          place next (dev)
        </button>
      </div>
      <TreeRenderer asset={asset} tree={tree} />
    </div>
  );
}
