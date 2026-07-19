// Clade Clash round generation (#36). A round is: a centre species and two candidates, one a
// clearly closer relative than the other. Raw nodal distance is coarse and tie-heavy, so we
// don't ask a coin flip — we GENERATE for a clear gap: the near candidate is much closer to
// the centre than the far one. Difficulty (and health damage) scale with that gap.
//
// What "closer" MEANS is a pluggable DistanceEngine, so the metric can change (shared-clade
// depth today; nodal edges or genetic divergence later) without touching the game loop. Phase
// 0 runs client-side over the loaded (blob) pool — the same packs as Time Attack.
// See docs/clade-clash-design.md.

import type { AssetTip, InternedAsset } from "../asset/types";
import { relatedness, type Relatedness } from "./distance";

// ---- distance engines -------------------------------------------------------------------

/** A distance engine defines what "closer relative" means. Swap it to change the metric
 *  without touching the game: the generator ranks/gaps candidates on `closeness`, the reveal
 *  reads `relate().mrcaRank`, and missing a round costs `damage(gap)` health. `closeness` is
 *  in whatever units the engine likes — the generator and damage are expressed in those same
 *  units, so engines are self-consistent and interchangeable. */
/** How the bot plays a round of a given gap: how likely it is to pick right, and a delay
 *  bias (ms) on top of the base reaction window. Owned by the engine so the thresholds live
 *  in the engine's own units, not hardcoded in the game loop (a new engine sets its own). */
export interface BotPolicy {
  accuracy: number; // P(bot picks the closer relative)
  delayBiasMs: number; // added to the base reaction delay (harder/closer rounds → slower)
}

export interface DistanceEngine {
  readonly id: string;
  readonly label: string;
  /** Relatedness of two tips — used for grading and the reveal's "shares family" label. */
  relate(asset: InternedAsset, a: string, b: string): Relatedness;
  /** Scalar closeness from a relatedness; BIGGER = more closely related. */
  closeness(r: Relatedness): number;
  /** Minimum closeness gap between the near and far candidate for a round to be "fair". */
  readonly minGap: number;
  /** Health a player loses for missing a round whose candidates differ by `gap` closeness. */
  damage(gap: number): number;
  /** How the bot plays a round of this `gap` (accuracy + delay bias). */
  bot(gap: number): BotPolicy;
}

/** Base reaction window the bot's delay bias is added to (ms). Shared across engines. The
 *  bot is meant to be a STRONG, "extremely efficient" opponent — snappy and near-optimal
 *  (the answer is derivable from the tree, so it plays close to perfectly), with just enough
 *  fallibility on the subtlest rounds to stay beatable. */
export const BOT_DELAY_MIN_MS = 450;
export const BOT_DELAY_JITTER_MS = 1100;

/** Default (Phase 0): rank by how DEEP the shared clade is — genus beats family beats order.
 *  Topology-only, no branch lengths needed. */
export const rankDepthEngine: DistanceEngine = {
  id: "rank-depth",
  label: "Shared-clade depth",
  relate: relatedness,
  closeness: (r) => r.sharedDepth,
  minGap: 2,
  damage: (gap) => Math.min(40, 12 + Math.max(0, gap - 2) * 7), // gap 2 → 12, up to a 40 cap
  // "Extremely efficient": all-but-perfect on obvious (wide-gap) rounds, only mildly fallible
  // on the subtlest ones; a touch slower when the gap is tight (still snappy).
  bot: (gap) => ({ accuracy: gap >= 3 ? 0.99 : 0.9, delayBiasMs: gap < 2 ? 400 : 0 }),
};

/** Alternative, ready to swap in: rank by NODAL edge distance (fewer edges between the tips =
 *  closer). Same reveal + game, a different notion of "closer" — here to prove the seam. */
export const nodalEngine: DistanceEngine = {
  id: "nodal",
  label: "Nodal edge distance",
  relate: relatedness,
  closeness: (r) => -r.nodal, // fewer edges apart = closer
  minGap: 2, // the far candidate must be ≥2 more edges away to count as clearly further
  damage: (gap) => Math.min(40, 8 + gap * 3),
  bot: (gap) => ({ accuracy: gap >= 4 ? 0.97 : 0.86, delayBiasMs: gap < 3 ? 600 : 0 }),
};

/** The engine the game uses unless told otherwise. Later this can be chosen per scope/config. */
export const DEFAULT_ENGINE = rankDepthEngine;

export const HP_MAX = 100; // starting health for a duel (GeoGuessr-style, #36)

// ---- round generation -------------------------------------------------------------------

export interface ClashRound {
  center: AssetTip;
  /** the two candidate cards, in display order (already shuffled). */
  options: [AssetTip, AssetTip];
  /** index (0|1) of the closer relative — the correct pick. */
  correct: 0 | 1;
  /** each option's relatedness to the centre, parallel to `options` (drives the reveal copy). */
  rel: [Relatedness, Relatedness];
  /** closeness gap between near and far, in the engine's units — difficulty + damage scale. */
  gap: number;
}

const SAMPLE = 400; // candidates compared against the centre per attempt (cheap; pools are ~thousands)
const ATTEMPTS = 16; // resample the centre this many times before giving up on a fair round

/** Build one round, or null if the pool is too small/flat to form a fair one (caller falls back).
 *  `engine` picks the metric; `rng` is injectable so a match can be seeded/replayed later. */
export function makeRound(
  asset: InternedAsset,
  engine: DistanceEngine = DEFAULT_ENGINE,
  rng: () => number = Math.random,
): ClashRound | null {
  const tips = asset.raw.tips;
  const N = tips.length;
  if (N < 8) return null;
  const pick = () => tips[(rng() * N) | 0];

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const center = pick();
    let near: { tip: AssetTip; r: Relatedness; c: number } | null = null;
    const pool: { tip: AssetTip; r: Relatedness; c: number }[] = [];
    const seen = new Set<string>([center.id]);

    const n = Math.min(SAMPLE, N);
    for (let i = 0; i < n; i++) {
      const t = pick();
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const r = engine.relate(asset, center.id, t.id);
      if (r.sharedDepth === 0) continue; // unrelated (only shares the implicit root) — skip
      const c = engine.closeness(r);
      pool.push({ tip: t, r, c });
      if (!near || c > near.c) near = { tip: t, r, c };
    }
    if (!near) continue;

    // The far candidate must be clearly less related than the near one, by the engine's margin.
    const fars = pool.filter((f) => f.tip.id !== near!.tip.id && near!.c - f.c >= engine.minGap);
    if (fars.length === 0) continue;
    const far = fars[(rng() * fars.length) | 0];

    const correctFirst = rng() < 0.5;
    const options: [AssetTip, AssetTip] = correctFirst ? [near.tip, far.tip] : [far.tip, near.tip];
    const rel: [Relatedness, Relatedness] = correctFirst ? [near.r, far.r] : [far.r, near.r];
    return { center, options, correct: correctFirst ? 0 : 1, rel, gap: near.c - far.c };
  }
  return null;
}
