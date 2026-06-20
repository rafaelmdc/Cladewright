// TreeRenderer — the shared tree-of-life view used by both games (Phase 2).
//
// Plan (docs/architecture.md, docs/marathon-design.md):
//   - render only the INDUCED tree (named tips + their MRCAs), never the backbone
//   - radial layout via d3-hierarchy (rectangular as a secondary mode)
//   - LAYOUT STABILITY IS A FEATURE: animate every position change (Framer Motion),
//     anchor the focused clade, never teleport on reflow
//   - node types: found tip (common bold / scientific italic), clade node, hidden-
//     sister label ("N hidden", count only — both A/B styles)
//   - pan / zoom / fit; densify on zoom; cull off-screen detail
//
// Phase 0: placeholder so the pages compose. No layout yet.

import type { InternedAsset } from "../lib/asset/types";
import type { InducedTree } from "../lib/tree/induced";

export interface TreeRendererProps {
  asset: InternedAsset;
  tree: InducedTree;
}

export function TreeRenderer({ asset, tree }: TreeRendererProps) {
  return (
    <div className="flex h-full w-full items-center justify-center text-clade-ink/40">
      {/* TODO(phase-2): real SVG radial renderer */}
      <p className="text-sm">
        TreeRenderer placeholder — {tree.tips.length} tips placed, asset v
        {asset.raw.version}
      </p>
    </div>
  );
}
