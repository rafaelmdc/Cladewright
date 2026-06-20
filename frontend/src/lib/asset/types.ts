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
  fame: number;
  time_weight: number;
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
  aliases: Record<string, string[]>; // normalized name -> tip ids
}

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
  hiddenLabelMax: number;
}
