// Wire shape of the game-data asset. Mirrors docs/game-asset-format.md — keep in
// sync with that contract and the backend pipeline's asset.py.

import type { FuseFilter } from "./membership";

export interface AssetNode {
  id: string;
  rank: string;
  sci: string;
  common: string | null;
  parent: string | null;
  pool_count: number; // # of pool tips beneath this node (denominator of "N remaining")
  pool_count_extant: number; // …excluding extinct tips (denominator when toggle is "living only")
}

export interface AssetTip {
  id: string;
  sci: string;
  common: string;
  parent: string;
  lineage: string[]; // ordered root→parent ancestor node ids; MRCA = last shared prefix
  // Popularity score (enwiki pageviews, sitelink-count fallback). Breaks ambiguous
  // name ties (famous "robin" wins). Optional: older assets predate it → treated as 0.
  // Keep in sync with backend asset.py.
  fame?: number;
  // Whether `common` is a REAL vernacular rather than the binomial the pipeline falls back
  // to when it finds none (#145). Optional: assets built before the flag existed omit it, and
  // lib/game/commonName.ts derives it for those. Keep in sync with backend asset.py.
  has_common?: boolean;
  // Whether the species has a picture on Wikipedia — the art every Clade Clash card is built
  // around (#146). Optional for the same reason; lib/wiki/images.ts fills the gap at runtime.
  has_image?: boolean;
  traits: {
    environment: string[];
    biomes: string[];
    extinct: boolean;
  };
}

export interface GameAsset {
  version: number;
  schema: string;
  scope: string;
  label?: string;
  pool_size: number;
  pool_size_extant?: number;
  thresholds: { hidden_label_max: number };
  provenance: Record<string, unknown>;
  nodes: AssetNode[];
  tips: AssetTip[];
  aliases: Record<string, string[]>; // normalized name -> tip OR clade-node ids
}

/** A resolved placement target: a species tip or a nameable clade node. */
export type Target =
  | { kind: "tip"; id: string; tip: AssetTip }
  | { kind: "node"; id: string; node: AssetNode };

// ---- Runtime form (after interning; see performance.md) ----
// The loader interns string ids to contiguous integer indices and packs the hot
// fields into integer arrays so the play loop is integer-only.
//
// Two ways an InternedAsset is built:
//   * blob mode  — intern() builds it whole from a downloaded GameAsset; arrays are
//     fixed-size Int32Array (the original, fastest path).
//   * remote mode — for a huge scope the blob is never downloaded; the asset starts
//     EMPTY and grows one organism at a time from /resolve (see asset/growable.ts).
//     The hot arrays are plain number[] so they can be appended to. Read access is
//     identical (`arr[i]`, `.length`), so the play loop is unchanged either way.
export type NumArray = Int32Array | number[];

/** One component of a MIXED asset that has a remote tail (a hybrid or remote scope). Its own
 *  scope key + version routes a tail `/resolve` to the right backend; its filter pre-rejects
 *  names "definitely absent" from THIS component (membership is per-scope, never unioned). */
export interface TailSource {
  scope: string;
  version?: number;
  filter?: FuseFilter;
  /** the component pack's tip count — the smaller-pack-wins tie-break tries tails in
   *  ascending size order (see resolveTarget + docs/lobby-and-config.md#name-collisions). */
  size?: number;
}

export interface InternedAsset {
  /** blob mode carries the full source asset; remote mode has only metadata + a
   *  growing `aliases` map (server is the source of truth for names). */
  raw: GameAsset;
  /** "blob" = complete pool downloaded whole; "hybrid" = a notable blob downloaded AND
   *  grown on the tail via /resolve (local alias index first, remote on miss); "remote" =
   *  started empty, grown entirely via /resolve. */
  mode: "blob" | "hybrid" | "remote";
  /** scope key, threaded onto /search + /resolve requests in remote mode */
  scope?: string;
  /** node id -> integer index */
  nodeIndex: Map<string, number>;
  /** index -> node id */
  nodeIds: string[];
  /** by node index: pool tips beneath (the "N remaining" denominator) */
  poolCount: NumArray;
  /** by node index: pool tips beneath excluding extinct (denominator when "living only") */
  poolCountExtant: NumArray;
  /** node index -> parent node index (-1 for root) */
  parent: NumArray;
  /** tip id -> ancestor node indices (root→parent). Fixed once a tip is known. */
  tipLineage: Map<string, Int32Array>;
  /** tip id -> tip record */
  tipById: Map<string, AssetTip>;
  /** clade-node id -> node record */
  nodeById: Map<string, AssetNode>;
  hiddenLabelMax: number;
  /** hybrid/remote: binary-fuse8 membership filter — a typed name that's "definitely
   *  absent" is rejected locally (no /search). Undefined for whole-pool blob scopes. */
  filter?: FuseFilter;
  /** MIXED hybrid/remote scopes: one tail per component, each routed to its own backend.
   *  A tail miss tries every component whose filter says "maybe" (or has none), smallest
   *  pack first (see resolveTarget). Undefined for a single-scope asset — that uses `scope`+`filter`. */
  tailSources?: TailSource[];
  /** MIXED packs only: target id (tip OR clade node) -> the tip count of the SMALLEST source
   *  pack that contains it. When a typed name resolves to candidates from >1 pack, the smaller
   *  pack wins (see resolve.ts + docs/lobby-and-config.md#name-collisions). Undefined for a
   *  single-pack asset (no overlap possible → no tie-break needed). */
  packSize?: Map<string, number>;
  /** hybrid/remote: normalized queries already known to resolve to nothing (filter-rejected
   *  or a remote miss), so a repeated typo never re-hits the network. */
  negativeCache?: Set<string>;
}
