// Load + intern the game-data asset. The intern step (string ids -> integer
// indices + typed arrays) is what makes the play loop integer-only; see
// docs/performance.md. This much is implemented because it's the load-bearing
// foundation everything else builds on.

import type { AssetNode, AssetTip, GameAsset, InternedAsset } from "./types";
import { mergeAssets } from "./merge";

// Primary source is the DB-backed API (served by Django, blob from Postgres) — same
// path as prod. Vite proxies /api -> :8000 in dev (see vite.config.ts). Fallbacks keep
// the app booting when the backend isn't running: the gitignored static Mammalia asset,
// then the committed tiny sample. Override the primary with VITE_GAMEDATA_URL.
const PRIMARY = import.meta.env.VITE_GAMEDATA_URL ?? "/api/gamedata/current/";
const FALLBACKS = ["/mammalia.json", "/sample_asset.json"];

/** Fetch one scope's raw asset, with dev fallbacks (used for the single-scope path). */
async function fetchRawAsset(scope?: string): Promise<GameAsset> {
  const primary = scope ? `${PRIMARY}?scope=${encodeURIComponent(scope)}` : PRIMARY;
  const sources = [primary, ...FALLBACKS];
  let lastStatus = 0;
  for (const src of sources) {
    try {
      const res = await fetch(src);
      if (res.ok) return (await res.json()) as GameAsset;
      lastStatus = res.status;
    } catch {
      // network error (e.g. backend down) — try the next source
    }
  }
  throw new Error(`Failed to load game asset (last status ${lastStatus})`);
}

/** Fetch one specific scope from the API only (no generic dev fallback — a fallback would
 *  pollute a multi-scope merge). Returns null on failure so the merge can skip it. */
async function fetchScopeAsset(scope: string): Promise<GameAsset | null> {
  try {
    const res = await fetch(`${PRIMARY}?scope=${encodeURIComponent(scope)}`);
    if (res.ok) return (await res.json()) as GameAsset;
  } catch {
    /* skip a scope that fails to load */
  }
  return null;
}

/** Load + intern a blob-mode asset. `scope` selects which current build to fetch
 *  (?scope=key); omitted = the server's default current. Dev fallbacks keep the app
 *  booting when the backend is down. */
export async function loadAsset(scope?: string): Promise<InternedAsset> {
  return intern(await fetchRawAsset(scope));
}

/** Load + merge several blob scopes into one playable asset (scope mixing). One scope
 *  delegates to loadAsset (keeps the dev fallback); many are fetched in parallel, the
 *  ones that load are merged. */
export async function loadAssets(scopes: string[]): Promise<InternedAsset> {
  const uniq = [...new Set(scopes.filter(Boolean))];
  if (uniq.length <= 1) return loadAsset(uniq[0]);
  const raws = (await Promise.all(uniq.map(fetchScopeAsset))).filter(
    (a): a is GameAsset => a !== null,
  );
  if (raws.length === 0) throw new Error("Failed to load any selected scope");
  return intern(mergeAssets(raws));
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
  const poolCountExtant = new Int32Array(n);
  const parent = new Int32Array(n);

  for (const node of raw.nodes) {
    const i = nodeIndex.get(node.id)!;
    poolCount[i] = node.pool_count;
    // Fallback to pool_count for assets built before extant counts existed.
    poolCountExtant[i] = node.pool_count_extant ?? node.pool_count;
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
    mode: "blob",
    scope: raw.scope,
    nodeIndex,
    nodeIds,
    poolCount,
    poolCountExtant,
    parent,
    tipLineage,
    tipById,
    nodeById,
    hiddenLabelMax: raw.thresholds.hidden_label_max,
  };
}
