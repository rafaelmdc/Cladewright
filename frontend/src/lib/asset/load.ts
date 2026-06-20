// Load + intern the game-data asset. The intern step (string ids -> integer
// indices + typed arrays) is what makes the play loop integer-only; see
// docs/performance.md. This much is implemented because it's the load-bearing
// foundation everything else builds on.

import type { GameAsset, InternedAsset } from "./types";

const DEFAULT_URL = import.meta.env.VITE_GAMEDATA_URL ?? "/sample_asset.json";

export async function loadAsset(url: string = DEFAULT_URL): Promise<InternedAsset> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load game asset: ${res.status}`);
  const raw: GameAsset = await res.json();
  return intern(raw);
}

export function intern(raw: GameAsset): InternedAsset {
  const nodeIndex = new Map<string, number>();
  const nodeIds: string[] = [];

  for (const node of raw.nodes) {
    nodeIndex.set(node.id, nodeIds.length);
    nodeIds.push(node.id);
  }

  const n = nodeIds.length;
  const poolCount = new Int32Array(n);
  const parent = new Int32Array(n);

  for (const node of raw.nodes) {
    const i = nodeIndex.get(node.id)!;
    poolCount[i] = node.pool_count;
    parent[i] = node.parent === null ? -1 : (nodeIndex.get(node.parent) ?? -1);
  }

  const tipLineage = new Map<string, Int32Array>();
  for (const tip of raw.tips) {
    const arr = new Int32Array(tip.lineage.length);
    for (let k = 0; k < tip.lineage.length; k++) {
      arr[k] = nodeIndex.get(tip.lineage[k]) ?? -1;
    }
    tipLineage.set(tip.id, arr);
  }

  return {
    raw,
    nodeIndex,
    nodeIds,
    poolCount,
    parent,
    tipLineage,
    hiddenLabelMax: raw.thresholds.hidden_label_max,
  };
}
