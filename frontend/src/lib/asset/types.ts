// Wire shape of the game-data asset. Mirrors docs/game-asset-format.md — keep in
// sync with that contract and the backend pipeline's asset.py.

export interface AssetNode {
  id: string;
  rank: string;
  sci: string;
  common: string | null;
  parent: string | null;
  pool_count: number; // # of pool tips beneath this node (denominator of "N remaining")
}

export interface AssetTip {
  id: string;
  sci: string;
  common: string;
  parent: string;
  lineage: string[]; // ordered root→parent ancestor node ids; MRCA = last shared prefix
  // (No fame/time_weight: the pageview popularity system is post-MVP; the Marathon
  //  time bonus is novelty-only, computed live. Keep in sync with backend asset.py.)
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
  pool_size: number;
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

export interface InternedAsset {
  /** blob mode carries the full source asset; remote mode has only metadata + a
   *  growing `aliases` map (server is the source of truth for names). */
  raw: GameAsset;
  /** "blob" = complete, downloaded whole; "remote" = grown incrementally via /resolve */
  mode: "blob" | "remote";
  /** scope key, threaded onto /search + /resolve requests in remote mode */
  scope?: string;
  /** node id -> integer index */
  nodeIndex: Map<string, number>;
  /** index -> node id */
  nodeIds: string[];
  /** by node index */
  poolCount: NumArray;
  /** node index -> parent node index (-1 for root) */
  parent: NumArray;
  /** tip id -> ancestor node indices (root→parent). Fixed once a tip is known. */
  tipLineage: Map<string, Int32Array>;
  /** tip id -> tip record */
  tipById: Map<string, AssetTip>;
  /** clade-node id -> node record */
  nodeById: Map<string, AssetNode>;
  hiddenLabelMax: number;
}
