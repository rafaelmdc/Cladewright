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
    // Capacity for whatever nodes exist now. In remote mode the asset grows as organisms
    // are resolved, so ensureCapacity() reallocates when it outgrows this.
    this.foundCount = new Int32Array(Math.max(asset.nodeIds.length, 1));
  }

  /** Grow foundCount to cover newly added nodes (remote mode), preserving counts. */
  private ensureCapacity(): void {
    const n = this.asset.nodeIds.length;
    if (n <= this.foundCount.length) return;
    let cap = this.foundCount.length;
    while (cap < n) cap *= 2; // amortized O(1) growth
    const grown = new Int32Array(cap);
    grown.set(this.foundCount);
    this.foundCount = grown;
  }

  /** Record a named tip: O(L) increment along its lineage. */
  name(tipId: string): void {
    const lineage = this.asset.tipLineage.get(tipId);
    if (!lineage) return;
    this.ensureCapacity();
    for (let k = 0; k < lineage.length; k++) {
      const idx = lineage[k];
      if (idx < 0) continue;
      this.foundCount[idx] += 1;
      this.maybeActivate(idx);
    }
  }

  remaining(nodeIdx: number): number {
    const found = nodeIdx < this.foundCount.length ? this.foundCount[nodeIdx] : 0;
    return this.asset.poolCount[nodeIdx] - found;
  }

  /** Clear all progress (new game) without reallocating the asset-derived arrays. */
  reset(): void {
    this.foundCount.fill(0);
    this.activeLabels.clear();
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
