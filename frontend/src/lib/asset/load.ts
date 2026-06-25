// Load + intern the game-data asset. The intern step (string ids -> integer
// indices + typed arrays) is what makes the play loop integer-only; see
// docs/performance.md. This much is implemented because it's the load-bearing
// foundation everything else builds on.

import type { AssetNode, AssetTip, GameAsset, InternedAsset } from "./types";
import { mergeAssets } from "./merge";
import { createEmptyAsset, seedHybridAsset } from "./growable";
import { fetchFilter } from "./remote";
import { readCachedAsset, writeCachedAsset } from "./cache";

// Primary source is the DB-backed API (served by Django, blob from Postgres) — same
// path as prod. Vite proxies /api -> :8000 in dev (see vite.config.ts). Fallbacks keep
// the app booting when the backend isn't running: the gitignored static Mammalia asset,
// then the committed tiny sample. Override the primary with VITE_GAMEDATA_URL.
const PRIMARY = import.meta.env.VITE_GAMEDATA_URL ?? "/api/gamedata/current/";
const FALLBACKS = ["/mammalia.json", "/sample_asset.json"];

// Local cache (#43): when the caller knows the scope's current `version` (from the cheap
// scopes metadata the app fetches before any asset), we check IndexedDB first and skip the
// multi-MB download on a hit; on a miss we fetch and re-cache. Version-keyed, so a rebuild
// invalidates it automatically — see lib/asset/cache.ts.
async function cacheFirst(
  url: string,
  scope: string | undefined,
  version: number | undefined,
): Promise<GameAsset | null> {
  if (scope && version != null) {
    const hit = await readCachedAsset(scope, version);
    if (hit) return hit;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const asset = (await res.json()) as GameAsset;
    // Cache under the asset's OWN version (authoritative), keyed by the scope we asked for.
    if (scope) void writeCachedAsset(scope, asset.version, asset);
    return asset;
  } catch {
    return null; // network error — caller decides whether to fall back
  }
}

/** Build the blob URL, pinning ?v=<version> when known so the response is immutable and
 *  the CDN can cache it (Cloudflare pull-through); omitted → the server serves "current". */
function blobUrl(scope?: string, version?: number): string {
  if (!scope) return PRIMARY;
  const u = new URLSearchParams({ scope });
  if (version) u.set("v", String(version));
  return `${PRIMARY}?${u.toString()}`;
}

/** Fetch one scope's raw asset, with dev fallbacks (used for the single-scope path). */
async function fetchRawAsset(scope?: string, version?: number): Promise<GameAsset> {
  const primary = blobUrl(scope, version);
  const cached = await cacheFirst(primary, scope, version);
  if (cached) return cached;
  // Primary missed (non-ok or network error); try the static dev fallbacks in order.
  let lastStatus = 0;
  for (const src of FALLBACKS) {
    try {
      const res = await fetch(src);
      if (res.ok) return (await res.json()) as GameAsset;
      lastStatus = res.status;
    } catch {
      // try the next source
    }
  }
  throw new Error(`Failed to load game asset (last status ${lastStatus})`);
}

/** Fetch one specific scope from the API only (no generic dev fallback — a fallback would
 *  pollute a multi-scope merge). Returns null on failure so the merge can skip it. */
async function fetchScopeAsset(scope: string, version?: number): Promise<GameAsset | null> {
  return cacheFirst(blobUrl(scope, version), scope, version);
}

/** Load + intern a blob-mode asset. `scope` selects which current build to fetch
 *  (?scope=key); omitted = the server's default current. `version` (from the scopes
 *  metadata) enables the local cache. Dev fallbacks keep the app booting when the backend
 *  is down. */
export async function loadAsset(scope?: string, version?: number): Promise<InternedAsset> {
  return intern(await fetchRawAsset(scope, version));
}

/** Load a hybrid scope: download its notable blob (capped top-fame subset + complete coarse
 *  backbone) and seed a growable asset from it, so the famous ~99% play locally and the tail
 *  grows via /resolve. `version` enables the local cache + pins the immutable blob URL. */
export async function loadHybridAsset(scope: string, version?: number): Promise<InternedAsset> {
  const [raw, filter] = await Promise.all([
    fetchRawAsset(scope, version),
    fetchFilter(scope, version),
  ]);
  const asset = seedHybridAsset(raw);
  if (filter) asset.filter = filter;
  return asset;
}

/** A pure-remote scope (no local blob): start empty, attach the membership filter so typos
 *  are rejected locally, and grow via /resolve. */
export async function loadRemoteAsset(
  scope: string,
  hiddenLabelMax: number,
  version?: number,
): Promise<InternedAsset> {
  const asset = createEmptyAsset(scope, hiddenLabelMax, version);
  const filter = await fetchFilter(scope, version);
  if (filter) asset.filter = filter;
  return asset;
}

/** Load + merge several blob scopes into one playable asset (scope mixing). One scope
 *  delegates to loadAsset (keeps the dev fallback); many are fetched in parallel, the
 *  ones that load are merged. `versions` (scope → current version) enables the per-scope
 *  local cache. */
export async function loadAssets(
  scopes: string[],
  versions?: Record<string, number>,
): Promise<InternedAsset> {
  const uniq = [...new Set(scopes.filter(Boolean))];
  if (uniq.length <= 1) return loadAsset(uniq[0], uniq[0] ? versions?.[uniq[0]] : undefined);
  const raws = (await Promise.all(uniq.map((s) => fetchScopeAsset(s, versions?.[s])))).filter(
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
