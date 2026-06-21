// Deterministic smoke test for the living-only toggle (no backend): build a tiny asset
// where a node's extant count differs from its total, fold a tip under it, and assert
// RemainingTracker.remaining() swaps denominators (pool_count vs pool_count_extant)
// correctly as `extantOnly` flips. Bundled + run via esbuild.
import { createEmptyAsset, foldResolved, type ResolvePayload } from "../src/lib/asset/growable";
import { RemainingTracker } from "../src/lib/game/remaining";
import { createInducedTree, place } from "../src/lib/tree/induced";

let failures = 0;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}

// A genus with 10 total tips but only 7 living (3 extinct), and one extant species under it.
const payload: ResolvePayload = {
  target: {
    id: "tip:Testus_vivus",
    kind: "tip",
    sci: "Testus vivus",
    common: "Living test beast",
    traits: { environment: [], biomes: [], extinct: false },
  },
  lineage: [
    { id: "kng:Animalia", rank: "kingdom", sci: "Animalia", common: "Animal", pool_count: 10, pool_count_extant: 7 },
    { id: "gen:Testus", rank: "genus", sci: "Testus", common: null, pool_count: 10, pool_count_extant: 7 },
  ],
};

const asset = createEmptyAsset("test", 15);
const tree = createInducedTree();
const tracker = new RemainingTracker(asset);

const target = foldResolved(asset, payload);
place(asset, tree, target);
tracker.name(target.id); // one extant tip found

const genus = asset.nodeIndex.get("gen:Testus")!;

tracker.extantOnly = false;
check("all-species denominator: 10 - 1 found = 9", tracker.remaining(genus) === 9,
      `got ${tracker.remaining(genus)}`);

tracker.extantOnly = true;
check("living-only denominator: 7 - 1 found = 6", tracker.remaining(genus) === 6,
      `got ${tracker.remaining(genus)}`);

tracker.extantOnly = false;
check("flips back to 9", tracker.remaining(genus) === 9, `got ${tracker.remaining(genus)}`);

check("folded extant count is distinct from total",
      asset.poolCountExtant[genus] === 7 && asset.poolCount[genus] === 10);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
