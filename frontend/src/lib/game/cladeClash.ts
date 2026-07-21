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
import { ensureImages, knownHasImage } from "../wikiImages";
import { commonNameOf, hasCommonName } from "./commonName";
import { relatedness, type Relatedness } from "./distance";
import type { NameLens } from "./settings";

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

/** The engines this build ships, by id — the registry a match resolves its `engineId`
 *  through. It mirrors `ENGINES` in `apps/clash/distance.py`, and the ids are the contract
 *  between them: a duel is created with an `engine_id`, and the client has to be able to look
 *  up the same metric to render and grade the same game.
 *
 *  **Adding an engine is adding an entry here and in distance.py** — nothing else in the game
 *  knows an engine by name. Both halves are needed: one alone gives you a metric that works in
 *  solo but not versus, or the reverse. */
export const ENGINES: Record<string, DistanceEngine> = {
  [rankDepthEngine.id]: rankDepthEngine,
  [nodalEngine.id]: nodalEngine,
};

/** The engine the game uses unless told otherwise. Later this can be chosen per scope/config. */
export const DEFAULT_ENGINE = rankDepthEngine;
export const DEFAULT_ENGINE_ID = rankDepthEngine.id;

/** Resolve an engine id to its engine, falling back to the default. A match whose engine this
 *  build doesn't ship still plays — on the default metric — rather than failing to render. */
export function engineFor(id: string | undefined | null): DistanceEngine {
  return (id && ENGINES[id]) || DEFAULT_ENGINE;
}

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

/** Tips sorted by fame, descending — computed once per asset, not per round.
 *
 *  Keyed weakly so it dies with the asset (a pack switch shouldn't leak the old ordering).
 *  `raw.tips` is sorted by id, and re-sorting 6k+ tips every round would be absurd. */
const famedOrder = new WeakMap<InternedAsset, AssetTip[]>();
function byFame(asset: InternedAsset): AssetTip[] {
  let out = famedOrder.get(asset);
  if (!out) {
    out = [...asset.raw.tips].sort((a, b) => (b.fame ?? 0) - (a.fame ?? 0));
    famedOrder.set(asset, out);
  }
  return out;
}

/** How sharply the draw skews: index = N * u^(1 + bias*FAME_SKEW).
 *
 *  Tuned against the real 6,441-tip mammalia pack, whose fame is savagely long-tailed (max
 *  1,375,313; MEDIAN 20) — so a gentle curve barely helps. Median species drawn, by skew:
 *
 *    skew  bias 0.6            bias 1.0
 *      4   rank 604  fame 46   rank 213  fame 932     — still nobody at the default
 *      8   rank 109  fame 2392 rank  14  fame 77058   — recognisable, still varied
 *     12   rank  21  fame 30k  rank   0  fame 1.4M    — degenerate: same animal every round
 *
 *  8 gives a playable default and a useful range without collapsing to a handful of species
 *  at the top of the dial. */
const FAME_SKEW = 8;

/** Build one round, or null if the pool is too small/flat to form a fair one (caller falls back).
 *  `engine` picks the metric; `rng` is injectable so a match can be seeded/replayed later.
 *
 *  `fameBias` (0..1, admin-tunable via GameDefaults) skews the draw toward well-known species.
 *  Drawing uniformly from a 6,000-species pack mostly produced animals nobody can recognise —
 *  "Puntilla tuco-tuco vs Furtive tuco-tuco" isn't a question, it's a coin flip. The bias
 *  DECAYS across attempts, so a pack whose famous end is too small or too flat to form a fair
 *  round still falls back to the old uniform behaviour rather than failing. */
export function makeRound(
  asset: InternedAsset,
  engine: DistanceEngine = DEFAULT_ENGINE,
  rng: () => number = Math.random,
  fameBias = 0,
  /** The tips this round may draw from, already fame-ordered — the PRESENTABLE subset (see
   *  playablePool). Filtering up front rather than rejecting after the draw keeps the fame
   *  skew meaningful: the exponent indexes into this list, so its famous end stays the famous
   *  end. Omit to draw from the whole pack. */
  pool?: AssetTip[],
): ClashRound | null {
  const bias = Math.max(0, Math.min(1, fameBias));
  const famed = pool ?? (bias > 0 ? byFame(asset) : asset.raw.tips);
  const N = famed.length;
  if (N < 8) return null;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    // Relax the skew as attempts fail: by the final tries this is a plain uniform draw, so a
    // high bias can never make a pack unplayable — only change which end we look at first.
    const strength = bias * (1 - attempt / ATTEMPTS);
    const exp = 1 + strength * FAME_SKEW;
    const pick = () => famed[Math.min(famed.length - 1, (famed.length * Math.pow(rng(), exp)) | 0)];

    const center = pick();
    let near: { tip: AssetTip; r: Relatedness; c: number } | null = null;
    const candidates: { tip: AssetTip; r: Relatedness; c: number }[] = [];
    const seen = new Set<string>([center.id]);

    const n = Math.min(SAMPLE, N);
    for (let i = 0; i < n; i++) {
      const t = pick();
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const r = engine.relate(asset, center.id, t.id);
      if (r.sharedDepth === 0) continue; // unrelated (only shares the implicit root) — skip
      const c = engine.closeness(r);
      candidates.push({ tip: t, r, c });
      if (!near || c > near.c) near = { tip: t, r, c };
    }
    if (!near) continue;

    // The far candidate must be clearly less related than the near one, by the engine's margin.
    const fars = candidates.filter((f) => f.tip.id !== near!.tip.id && near!.c - f.c >= engine.minGap);
    if (fars.length === 0) continue;
    const far = fars[(rng() * fars.length) | 0];

    const correctFirst = rng() < 0.5;
    const options: [AssetTip, AssetTip] = correctFirst ? [near.tip, far.tip] : [far.tip, near.tip];
    const rel: [Relatedness, Relatedness] = correctFirst ? [near.r, far.r] : [far.r, near.r];
    return { center, options, correct: correctFirst ? 0 : 1, rel, gap: near.c - far.c };
  }
  return null;
}

// ---- presentability: only draw species the game can actually SHOW (#145, #146) ------------
//
// A round is three cards, and a card is a picture with a name under it. A species with no
// picture is a hatched placeholder, and under the "Common" lens a species with no vernacular
// silently shows Latin — both turn a round into a non-question. Fame was doing this job by
// proxy and doing it badly, so the generator now draws from a pool that is filtered on the
// real signals.

/** The fame-ordered tips of `asset` that have a real common name. Memoized per (asset, lens):
 *  it normalizes every name in the pack, which is far too much work to repeat per round.
 *  Keyed weakly so it dies with the asset, like `byFame`. */
const namedPools = new WeakMap<InternedAsset, Map<string, AssetTip[]>>();
function namedPool(asset: InternedAsset, lens: NameLens): AssetTip[] {
  let byLens = namedPools.get(asset);
  if (!byLens) namedPools.set(asset, (byLens = new Map()));
  let out = byLens.get(lens);
  if (!out) {
    const ordered = byFame(asset);
    // "Common" and "both" both promise a name a person would say, so both require one — and
    // "both" is the DEFAULT, which is where #145 was actually seen. "Scientific" withholds
    // the common name deliberately, so it draws from the whole pack and stays the widest
    // (and hardest) lens.
    out = lens === "scientific" ? ordered : ordered.filter(hasCommonName);
    byLens.set(lens, out);
  }
  return out;
}

/** How many candidate rounds to draw and screen in one go. Their ~3N distinct species fit in
 *  a single 50-title image lookup, so the whole screening pass is one request. */
const SCREEN_BATCH = 12;

export interface RoundOptions {
  engine?: DistanceEngine;
  rng?: () => number;
  fameBias?: number;
  /** The lens the run is playing under — decides whether a vernacular is required. */
  lens?: NameLens;
  /** Set false to skip the image screen (and its network call) entirely. */
  requireImage?: boolean;
}

/** Draw a round whose three species can all actually be shown: a real common name when the
 *  lens needs one, and a picture on all three cards.
 *
 *  Rounds are drawn in a batch and screened together, because the image answer comes from the
 *  network: one request settles the whole batch, and the answers are cached permanently, so a
 *  warmed pack screens with no request at all. Falls back to an unscreened round rather than
 *  failing — a pack with little art still plays, it just looks worse, which beats a dead game. */
export async function makeShowableRound(
  asset: InternedAsset,
  opts: RoundOptions = {},
): Promise<ClashRound | null> {
  const { engine = DEFAULT_ENGINE, rng = Math.random, fameBias = 0, lens = "both" } = opts;
  const requireImage = opts.requireImage ?? true;
  const pool = namedPool(asset, lens);

  const draw = () => makeRound(asset, engine, rng, fameBias, pool);
  if (!requireImage) return draw();

  const rounds: ClashRound[] = [];
  for (let i = 0; i < SCREEN_BATCH; i++) {
    const r = draw();
    if (r) rounds.push(r);
  }
  if (rounds.length === 0) return null;

  const cards = (r: ClashRound) => [r.center, r.options[0], r.options[1]];
  // Screen the same titles the card itself will try, in the same order (SpecimenPlate asks for
  // the binomial first, then the common name), so the verdict matches what gets rendered.
  const titlesOf = (t: AssetTip) => {
    const c = commonNameOf(t);
    return c ? [t.sci, c] : [t.sci];
  };
  // Prefer a species' own baked flag — a build that has it needs no lookup at all.
  await ensureImages(rounds.flatMap(cards).filter((t) => t.has_image === undefined).flatMap(titlesOf));

  // Unknown counts as showable: a failed lookup must not empty the board.
  const shows = (t: AssetTip) =>
    t.has_image ?? titlesOf(t).some((n) => knownHasImage(n) !== false);
  return rounds.find((r) => cards(r).every(shows)) ?? rounds[0];
}
