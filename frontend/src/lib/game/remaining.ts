// The "N remaining" clade counter — the lightweight core of Marathon.
// found_count is maintained incrementally: naming a tip increments only the ≤~25
// nodes on its lineage path (O(L)), and because `remaining` only ever decreases,
// each branch crosses the reveal threshold at most once. Nothing scans all nodes.
// Full design + complexity table: docs/performance.md.

import type { InternedAsset } from "../asset/types";

export class RemainingTracker {
  private foundCount: Int32Array;
  /** node indices currently eligible to show a count (remaining<=max && found>=1) */
  readonly activeLabels = new Set<number>();

  constructor(private readonly asset: InternedAsset) {
    this.foundCount = new Int32Array(asset.nodeIds.length);
  }

  /** Record a named tip: O(L) increment along its lineage. */
  name(tipId: string): void {
    const lineage = this.asset.tipLineage.get(tipId);
    if (!lineage) return;
    for (let k = 0; k < lineage.length; k++) {
      const idx = lineage[k];
      if (idx < 0) continue;
      this.foundCount[idx] += 1;
      this.maybeActivate(idx);
    }
  }

  remaining(nodeIdx: number): number {
    return this.asset.poolCount[nodeIdx] - this.foundCount[nodeIdx];
  }

  private maybeActivate(nodeIdx: number): void {
    if (this.activeLabels.has(nodeIdx)) return;
    if (this.foundCount[nodeIdx] >= 1 && this.remaining(nodeIdx) <= this.asset.hiddenLabelMax) {
      this.activeLabels.add(nodeIdx);
    }
  }

  // TODO(phase-3): deepest-branch roll-up — among active labels on a path, show the
  // count on the deepest VISIBLE node and suppress shallower ancestors unless the
  // player expands them (zoom/hover). Local to the named tip's path. See
  // docs/marathon-design.md#why-this-doesnt-clutter.
}
