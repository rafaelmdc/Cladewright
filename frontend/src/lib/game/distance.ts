// Phylogenetic distance from tree topology alone — the shared primitive Clade Clash grades
// on (#36) and the deferred distance-decay (#126) / vicinity (#127) modifiers build on.
//
// The asset is topology-only: each tip carries its `lineage` (root→parent ancestor node
// indices) and each node a taxonomic `rank`. There are NO branch lengths and NO sequences,
// so "closeness" is: how deep is the most-recent common ancestor (shared prefix), and how
// many edges apart are the two tips. Everything here is O(L) over the lineage arrays.
//
// See docs/clade-clash-design.md#the-distance-signal.

import type { InternedAsset } from "../asset/types";

export interface Relatedness {
  /** node index of the most-recent common ancestor; -1 if the tips share nothing. */
  mrcaIdx: number;
  /** taxonomic rank of the MRCA (e.g. "genus", "family"), or null if none. Drives the reveal. */
  mrcaRank: string | null;
  /** length of the shared root→parent ancestor prefix — the deeper it goes, the closer the tips. */
  sharedDepth: number;
  /** nodal (edge) distance between the two tips through their MRCA. Infinity if unrelated. */
  nodal: number;
}

const UNRELATED: Relatedness = { mrcaIdx: -1, mrcaRank: null, sharedDepth: 0, nodal: Infinity };

/** Relatedness of two tips: their MRCA (index + rank), the shared ancestor depth (bigger =
 *  closer), and the nodal/edge distance. Symmetric; O(min lineage length). */
export function relatedness(asset: InternedAsset, tipA: string, tipB: string): Relatedness {
  if (tipA === tipB) return UNRELATED; // a tip isn't its own relative — callers pass distinct tips
  const a = asset.tipLineage.get(tipA);
  const b = asset.tipLineage.get(tipB);
  if (!a || !b) return UNRELATED;
  let s = 0;
  const len = Math.min(a.length, b.length);
  while (s < len && a[s] === b[s]) s++;
  if (s === 0) return { ...UNRELATED };
  const mrcaIdx = a[s - 1];
  // Edges: each tip sits one edge below its parent; the path to the MRCA climbs
  // (lineage.length - s) internal nodes from that parent. So per tip = (len - s) + 1.
  const nodal = a.length + b.length - 2 * s + 2;
  const node = asset.nodeById.get(asset.nodeIds[mrcaIdx]);
  return { mrcaIdx, mrcaRank: node?.rank ?? null, sharedDepth: s, nodal };
}

export interface CloserResult {
  /** 0 if `y` is the closer relative of `center`, 1 if `z`, -1 on an effective tie. */
  winner: 0 | 1 | -1;
  ry: Relatedness;
  rz: Relatedness;
}

/** Which of two candidates is the closer relative of `center`. Closeness is deeper shared
 *  ancestry first, then smaller nodal distance; equal on both = a tie (-1), which the round
 *  generator rejects so ranked play never hinges on a coin flip. This is the authoritative
 *  judgement — the client can derive it, so integrity comes from server grading + timing,
 *  not from hiding this (see docs/clade-clash-design.md#security-model). */
export function closer(asset: InternedAsset, center: string, y: string, z: string): CloserResult {
  const ry = relatedness(asset, center, y);
  const rz = relatedness(asset, center, z);
  if (ry.sharedDepth !== rz.sharedDepth) return { winner: ry.sharedDepth > rz.sharedDepth ? 0 : 1, ry, rz };
  if (ry.nodal !== rz.nodal) return { winner: ry.nodal < rz.nodal ? 0 : 1, ry, rz };
  return { winner: -1, ry, rz };
}
