// Clade Clash round generation (#36). A round is: a centre species and two candidates, one a
// clearly closer relative than the other. Raw nodal distance is coarse and tie-heavy, so we
// don't ask a coin flip — we GENERATE for a clear gap: the near candidate shares a deep
// ancestor with the centre, the far one branches off well shallower. Difficulty = the gap.
//
// Phase 0 runs client-side over the loaded (blob) pool — the same packs as Time Attack. The
// judgement is re-derivable server-side from the same lineage data when ranked play needs it.
// See docs/clade-clash-design.md.

import type { AssetTip, InternedAsset } from "../asset/types";
import { relatedness, type Relatedness } from "./distance";

export interface ClashRound {
  center: AssetTip;
  /** the two candidate cards, in display order (already shuffled). */
  options: [AssetTip, AssetTip];
  /** index (0|1) of the closer relative — the correct pick. */
  correct: 0 | 1;
  /** each option's relatedness to the centre, parallel to `options` (drives the reveal copy). */
  rel: [Relatedness, Relatedness];
  /** shared-depth gap between near and far; larger = easier (more obvious), so it scales scoring. */
  gap: number;
}

const SAMPLE = 400; // candidates compared against the centre per attempt (cheap; pools are ~thousands)
const MIN_GAP = 2; // required shared-depth margin so the closer relative is unambiguous
const ATTEMPTS = 16; // resample the centre this many times before giving up on a fair round

/** Build one round, or null if the pool is too small/flat to form a fair one (caller falls back).
 *  `rng` is injectable so a match can be seeded/replayed deterministically later. */
export function makeRound(asset: InternedAsset, rng: () => number = Math.random): ClashRound | null {
  const tips = asset.raw.tips;
  const N = tips.length;
  if (N < 8) return null;
  const pick = () => tips[(rng() * N) | 0];

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const center = pick();
    let near: { tip: AssetTip; r: Relatedness } | null = null;
    const pool: { tip: AssetTip; r: Relatedness }[] = [];
    const seen = new Set<string>([center.id]);

    const n = Math.min(SAMPLE, N);
    for (let i = 0; i < n; i++) {
      const t = pick();
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const r = relatedness(asset, center.id, t.id);
      if (r.sharedDepth === 0) continue; // unrelated (only shares the implicit root) — skip
      pool.push({ tip: t, r });
      if (!near || r.sharedDepth > near.r.sharedDepth) near = { tip: t, r };
    }
    if (!near) continue;

    // The far candidate must branch off clearly shallower than the near one.
    const fars = pool.filter((f) => f.tip.id !== near!.tip.id && near!.r.sharedDepth - f.r.sharedDepth >= MIN_GAP);
    if (fars.length === 0) continue;
    const far = fars[(rng() * fars.length) | 0];

    const correctFirst = rng() < 0.5;
    const options: [AssetTip, AssetTip] = correctFirst ? [near.tip, far.tip] : [far.tip, near.tip];
    const rel: [Relatedness, Relatedness] = correctFirst ? [near.r, far.r] : [far.r, near.r];
    return { center, options, correct: correctFirst ? 0 : 1, rel, gap: near.r.sharedDepth - far.r.sharedDepth };
  }
  return null;
}

export const HP_MAX = 100; // starting health for a duel (GeoGuessr-style, #36)

/** Damage the round's LOSER takes in the health duel. A bigger gap means the closer relative
 *  was more obvious, so missing it hurts more; missing a near-tie is cheap. Only a DIFFERING
 *  outcome deals damage — if both players pick the same side (both right or both wrong) it's a
 *  wash and nobody loses health. So your health is in your own hands: pick clean, take no hits. */
export function roundDamage(gap: number): number {
  return Math.min(40, 12 + Math.max(0, gap - MIN_GAP) * 7); // gap 2 → 12, up to a 40 cap
}
