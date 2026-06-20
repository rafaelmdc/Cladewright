// Player-input normalizer — MUST match backend pipeline/enrich.py::normalize exactly,
// because the asset's `aliases` keys are baked with that function. Any divergence means
// a typed name silently fails to hit a baked key.
//
//   lowercase → underscores to spaces → drop punctuation → collapse whitespace.
//
// Plurals are NOT handled here: the build bakes both singular and plural keys
// (index_keys), so "bears" and "bear" are both present as keys. Resolution stays a
// single O(1) lookup. See docs/marathon-design.md#name-resolution.

export function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/[^\w\s]/g, "") // drop punctuation (\w keeps letters/digits/underscore)
    .replace(/[\s_]+/g, " ") // fold any residual underscore + whitespace runs
    .trim();
}
