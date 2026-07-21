// Does a species actually HAVE a common name? (#145)
//
// The asset's `tip.common` is never null — the pipeline falls back to the binomial when no
// vernacular exists (`enrich.py`: `common = provider.common_name(taxon) or scientific_name`).
// That was fine for Time Attack, where `common` is only ever a display string, but Clade
// Clash has a "Common" name lens whose whole promise is that you see common names — and on
// a pack like Fish, 65% of tips have no vernacular, so the lens silently served Latin.
//
// So "has a common name" needs to be a real boolean, not a guess at the render site. Builds
// from now on bake it (`AssetTip.has_common`); this module is the single reader of that flag
// AND the fallback that derives it for the assets already built and served, which is every
// pack in production today. Deriving it is exact rather than heuristic: the pipeline's
// fallback IS the scientific name, so `common == sci` means "none".

import type { AssetTip } from "../asset/types";
import { normalize } from "./normalize";

/** A Wikipedia title harvested as a common name can carry a disambiguation parenthetical —
 *  "Pholidota (plant)" — which is a title artifact, never a vernacular. Strip it before
 *  comparing (and before displaying). Mirrors NodeCard's long-standing cleanCommon (#21). */
function strip(common: string): string {
  return common.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Written in the Latin alphabet? The harvest pulls vernaculars from Wikidata in whatever
 *  languages an item happens to carry, so a species with no English name can surface a
 *  Japanese one ("キビレマツカサ" for Myripristis chryseres). Accents are fine — plenty of
 *  legitimate English vernaculars carry them — anything outside the Latin script is not. */
function isLatinScript(name: string): boolean {
  return /\p{Script=Latin}/u.test(name) && !/[^\p{Script=Latin}\p{N}\p{P}\p{Zs}]/u.test(name);
}

/** Is this "common name" actually a scientific binomial for the same species?
 *
 *  Wikidata carries SYNONYMS as alternative labels, so a species that has been moved between
 *  genera picks up its old binomial as a "vernacular" — *Abactochromis labrosus* is served
 *  with the common name "Melanochromis labrosus", which is Latin twice over. It escapes the
 *  equals-`sci` test because the genus differs, and that is exactly the giveaway: a genus
 *  transfer keeps the specific epithet, so a two-word name whose second word IS this species'
 *  epithet, behind a capitalised first word, is a binomial and not something anyone says. */
function isSynonymBinomial(name: string, sci: string): boolean {
  const parts = name.split(/\s+/);
  const epithet = sci.split(/\s+/)[1];
  return (
    parts.length === 2 &&
    !!epithet &&
    /^\p{Lu}\p{Ll}+$/u.test(parts[0]) &&
    parts[1].toLowerCase() === epithet.toLowerCase()
  );
}

/** The species' real common name, or null when the asset has nothing but Latin to offer. */
export function commonNameOf(tip: { common?: string | null; sci: string }): string | null {
  const cleaned = strip(tip.common ?? "");
  if (!cleaned) return null;
  if (normalize(cleaned) === normalize(tip.sci)) return null; // the pipeline's own fallback
  if (!isLatinScript(cleaned)) return null;
  if (isSynonymBinomial(cleaned, tip.sci)) return null;
  return cleaned;
}

/** Whether a tip has a real vernacular name. Prefers the baked flag (exact, and the only
 *  thing the SERVER can see); falls back to deriving it for assets built before #145. */
export function hasCommonName(tip: AssetTip): boolean {
  if (typeof tip.has_common === "boolean") return tip.has_common;
  return commonNameOf(tip) !== null;
}
