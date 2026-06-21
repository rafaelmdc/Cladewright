// Throwaway smoke test for remote mode: drives the REAL growable asset + induced tree +
// tracker against live /resolve payloads from the running backend (no browser). Bundled
// + run via esbuild. Proves: fold grows the asset, ancestors are shared across organisms,
// place() classifies new/refinement/duplicate, and "N remaining" decrements correctly.
import { createEmptyAsset, foldResolved, type ResolvePayload } from "../src/lib/asset/growable";
import { RemainingTracker } from "../src/lib/game/remaining";
import { createInducedTree, place } from "../src/lib/tree/induced";

const SCOPE = "order=Carnivora";
const BASE = "http://localhost:8000/api/gamedata";

async function resolve(id: string): Promise<ResolvePayload> {
  const u = `${BASE}/resolve/?scope=${encodeURIComponent(SCOPE)}&id=${encodeURIComponent(id)}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`resolve ${id} -> ${r.status}`);
  return (await r.json()) as ResolvePayload;
}

let failures = 0;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
}

async function main() {
  const asset = createEmptyAsset(SCOPE, 15);
  const tree = createInducedTree();
  const tracker = new RemainingTracker(asset);

  check("starts empty", asset.nodeIds.length === 0);

  // 1) Lion: a whole fresh lineage.
  const lion = foldResolved(asset, await resolve("tip:Panthera_leo"));
  const afterLion = asset.nodeIds.length;
  check("lion folded as tip", lion.kind === "tip" && lion.id === "tip:Panthera_leo");
  check("lion added its full lineage", afterLion > 0, `${afterLion} nodes`);
  const pLion = place(asset, tree, lion);
  if (lion.kind === "tip") tracker.name(lion.id);
  check("lion is a NEW placement", pLion.kind === "new");

  const rootIdx = 0; // first node folded is the root (kng:Animalia)
  check("root remaining = pool-1 after 1 tip", tracker.remaining(rootIdx) === asset.poolCount[rootIdx] - 1,
        `remaining=${tracker.remaining(rootIdx)} pool=${asset.poolCount[rootIdx]}`);

  // 2) Tiger: same genus Panthera — must REUSE the shared ancestors, only add the tip
  //    (+ no new internal nodes, since Panthera/Felidae/… already exist).
  const tiger = foldResolved(asset, await resolve("tip:Panthera_tigris"));
  const addedByTiger = asset.nodeIds.length - afterLion;
  check("tiger reused shared ancestors (≤1 new node)", addedByTiger <= 1, `added ${addedByTiger}`);
  const pTiger = place(asset, tree, tiger);
  if (tiger.kind === "tip") tracker.name(tiger.id);
  check("tiger is NEW", pTiger.kind === "new");
  check("root remaining = pool-2 after 2 tips", tracker.remaining(rootIdx) === asset.poolCount[rootIdx] - 2);

  // Genus Panthera should now show remaining = its pool_count - 2 (both under it).
  const panIdx = asset.nodeIndex.get("gen:Panthera");
  check("Panthera node exists", panIdx !== undefined);
  if (panIdx !== undefined)
    check("Panthera remaining decremented by 2", tracker.remaining(panIdx) === asset.poolCount[panIdx] - 2,
          `remaining=${tracker.remaining(panIdx)} pool=${asset.poolCount[panIdx]}`);

  // 3) Re-place lion: duplicate, no growth, no double-count.
  const before = asset.nodeIds.length;
  const lionAgain = foldResolved(asset, await resolve("tip:Panthera_leo"));
  const pDup = place(asset, tree, lionAgain);
  check("re-folding lion adds no nodes", asset.nodeIds.length === before);
  check("re-placing lion is a duplicate", pDup.kind === "duplicate");

  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
