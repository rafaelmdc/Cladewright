// A *growable* InternedAsset for huge-scope "remote" mode. The blob is never
// downloaded; the asset starts empty and grows one organism at a time from the
// /resolve endpoint (see docs/architecture.md#scaling-to-huge-scope). The play loop
// (resolve/place/RemainingTracker/induced/mrca) reads the SAME InternedAsset shape, so
// once a tip + its lineage are folded in here, everything downstream works unchanged.
//
// Server stays light by construction: each organism's lineage is fetched at most ONCE
// (resolveRemote caches), and what we fold in here is permanent for the session.

import type { AssetNode, AssetTip, GameAsset, InternedAsset, Target } from "./types";

/** One node on a /resolve lineage (matches ResolveView's payload). */
export interface ResolvedNode {
  id: string;
  rank: string;
  sci: string;
  common: string | null;
  pool_count: number;
  pool_count_extant?: number; // absent on older serves -> falls back to pool_count
}

/** A /resolve response: the placed target plus its denormalized root→… lineage. */
export interface ResolvePayload {
  target:
    | { id: string; kind: "tip"; sci: string; common: string; traits: AssetTip["traits"] }
    | { id: string; kind: "node"; sci: string; common: string | null; rank: string; pool_count: number };
  lineage: ResolvedNode[];
}

/** An empty remote-mode asset: no nodes/tips yet, grown by foldResolved(). */
export function createEmptyAsset(scope: string, hiddenLabelMax: number): InternedAsset {
  const raw: GameAsset = {
    version: 0,
    schema: "1.0",
    scope,
    pool_size: 0,
    thresholds: { hidden_label_max: hiddenLabelMax },
    provenance: {},
    nodes: [],
    tips: [],
    aliases: {}, // unused in remote mode — name resolution is server-side (/search)
  };
  return {
    raw,
    mode: "remote",
    scope,
    nodeIndex: new Map(),
    nodeIds: [],
    poolCount: [], // number[] so we can append
    poolCountExtant: [],
    parent: [],
    tipLineage: new Map(),
    tipById: new Map(),
    nodeById: new Map(),
    hiddenLabelMax,
  };
}

/** Add one lineage node if new; return its integer index. Parent is the previous
 *  lineage entry (the chain is ordered root→…), so the parent index is always already
 *  assigned by the time we reach a child. Shared ancestors are inserted once. */
function ensureNode(
  asset: InternedAsset,
  node: ResolvedNode,
  parentIdx: number,
): number {
  const existing = asset.nodeIndex.get(node.id);
  if (existing !== undefined) return existing;

  const idx = asset.nodeIds.length;
  const extant = node.pool_count_extant ?? node.pool_count;
  asset.nodeIndex.set(node.id, idx);
  asset.nodeIds.push(node.id);
  (asset.poolCount as number[]).push(node.pool_count);
  (asset.poolCountExtant as number[]).push(extant);
  (asset.parent as number[]).push(parentIdx);

  const parentId = parentIdx >= 0 ? asset.nodeIds[parentIdx] : null;
  const record: AssetNode = {
    id: node.id,
    rank: node.rank,
    sci: node.sci,
    common: node.common,
    parent: parentId,
    pool_count: node.pool_count,
    pool_count_extant: extant,
  };
  asset.nodeById.set(node.id, record);
  return idx;
}

/**
 * Fold a /resolve response into the growing asset and return the placement Target.
 * Idempotent: re-folding the same organism is a no-op that still returns the Target.
 * O(L) — only touches this organism's lineage.
 */
export function foldResolved(asset: InternedAsset, payload: ResolvePayload): Target {
  // 1) Materialize the ancestor chain (root→…), wiring each node's parent index.
  const lineageIdx: number[] = [];
  let parentIdx = -1;
  for (const n of payload.lineage) {
    parentIdx = ensureNode(asset, n, parentIdx);
    lineageIdx.push(parentIdx);
  }

  // 2a) A clade node target IS the last lineage entry — already folded above.
  if (payload.target.kind === "node") {
    const node = asset.nodeById.get(payload.target.id)!;
    return { kind: "node", id: payload.target.id, node };
  }

  // 2b) A tip: its lineage is the whole ancestor chain; parent is the last node.
  const id = payload.target.id;
  const existingTip = asset.tipById.get(id);
  if (existingTip) return { kind: "tip", id, tip: existingTip };

  const tip: AssetTip = {
    id,
    sci: payload.target.sci,
    common: payload.target.common,
    parent: payload.lineage.length ? payload.lineage[payload.lineage.length - 1].id : "",
    lineage: payload.lineage.map((n) => n.id),
    traits: payload.target.traits,
  };
  asset.tipById.set(id, tip);
  asset.tipLineage.set(id, Int32Array.from(lineageIdx));
  return { kind: "tip", id, tip };
}
