// Load + intern the game-data asset. The intern step (string ids -> integer
// indices + typed arrays) is what makes the play loop integer-only; see
// docs/performance.md. This much is implemented because it's the load-bearing
// foundation everything else builds on.

import type { AssetNode, AssetTip, GameAsset, InternedAsset } from "./types";

// Primary source is the DB-backed API (served by Django, blob from Postgres) — same
// path as prod. Vite proxies /api -> :8000 in dev (see vite.config.ts). Fallbacks keep
// the app booting when the backend isn't running: the gitignored static Mammalia asset,
// then the committed tiny sample. Override the primary with VITE_GAMEDATA_URL.
const SOURCES = [
  import.meta.env.VITE_GAMEDATA_URL ?? "/api/gamedata/current/",
  "/mammalia.json",
  "/sample_asset.json",
];

export async function loadAsset(url?: string): Promise<InternedAsset> {
  const sources = url ? [url] : SOURCES;
  let lastStatus = 0;
  for (const src of sources) {
    try {
      const res = await fetch(src);
      if (res.ok) {
        const raw: GameAsset = await res.json();
        return intern(raw);
      }
      lastStatus = res.status;
    } catch {
      // network error (e.g. backend down) — try the next source
    }
  }
  throw new Error(`Failed to load game asset (last status ${lastStatus})`);
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
  const tipById = new Map<string, AssetTip>();
  for (const tip of raw.tips) {
    const arr = new Int32Array(tip.lineage.length);
    for (let k = 0; k < tip.lineage.length; k++) {
      arr[k] = nodeIndex.get(tip.lineage[k]) ?? -1;
    }
    tipLineage.set(tip.id, arr);
    tipById.set(tip.id, tip);
  }

  const nodeById = new Map<string, AssetNode>();
  for (const node of raw.nodes) nodeById.set(node.id, node);

  return {
    raw,
    nodeIndex,
    nodeIds,
    poolCount,
    parent,
    tipLineage,
    tipById,
    nodeById,
    hiddenLabelMax: raw.thresholds.hidden_label_max,
  };
}
