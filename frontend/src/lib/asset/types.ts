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
// fields into typed arrays so the play loop is integer-only.
export interface InternedAsset {
  raw: GameAsset;
  /** node id -> integer index */
  nodeIndex: Map<string, number>;
  /** index -> node id */
  nodeIds: string[];
  /** by node index */
  poolCount: Int32Array;
  /** node index -> parent node index (-1 for root) */
  parent: Int32Array;
  /** tip id -> Int32Array of ancestor node indices (root→parent) */
  tipLineage: Map<string, Int32Array>;
  /** tip id -> tip record */
  tipById: Map<string, AssetTip>;
  /** clade-node id -> node record */
  nodeById: Map<string, AssetNode>;
  hiddenLabelMax: number;
}
