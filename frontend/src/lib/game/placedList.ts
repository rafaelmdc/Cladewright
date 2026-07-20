// The "No tree" modifier's board data (#101). Pure display-list construction, kept out of
// the component file so <PlacedList> exports a component and nothing else — react-refresh
// only does fast refresh for modules that export components exclusively.

import type { InternedAsset } from "../asset/types";

export interface PlacedEntry {
  id: string;
  kind: "tip" | "node";
  primary: string;
  secondary?: string;
  rank?: string;
}

/** Build the display list from the run's ordered placements (tips + named clades, dupes already
 *  excluded upstream). Newest first. Names follow the same common/scientific lens as the tree. */
export function buildPlacedList(
  asset: InternedAsset,
  placedIds: string[],
  opts: { showScientific: boolean; scientificPrimary: boolean },
): PlacedEntry[] {
  const out: PlacedEntry[] = [];
  for (const id of placedIds) {
    const tip = asset.tipById.get(id);
    if (tip) {
      const common = tip.common ?? tip.sci;
      const primary = opts.scientificPrimary ? tip.sci : common;
      const secondary = opts.scientificPrimary
        ? common !== tip.sci ? common : undefined
        : opts.showScientific && tip.sci !== primary ? tip.sci : undefined;
      out.push({ id, kind: "tip", primary, secondary });
      continue;
    }
    const node = asset.nodeById.get(id);
    if (node) {
      const primary = node.common && !opts.scientificPrimary ? node.common : node.sci;
      const secondary = node.common && node.common !== primary ? node.common : undefined;
      out.push({ id, kind: "node", primary, secondary, rank: node.rank });
    }
  }
  out.reverse(); // newest first
  return out;
}
