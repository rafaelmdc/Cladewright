"""One-off: full braidworks-enriched Mammalia build + coverage report.

Drives the pipeline directly (bypasses Django settings, which need corsheaders).
Harvests names for ALL nodes — species AND every clade node — exactly like the
animalist reference, so clade names ("anteater", "bear", "sloth") resolve.
"""
import time
from pathlib import Path

from pipeline import asset, backbone, enrich, ingest, paraphyletic, pool, validate

t0 = time.time()
coldp = Path("../data/coldp_mammalia")
out = Path("../data/out/mammalia.json")

taxa = ingest.ingest_coldp(coldp, scope="class=Mammalia")
print(f"ingest: {len(taxa)} accepted species", flush=True)

tree = backbone.build_backbone(taxa)
print(f"backbone: {len(tree.nodes)} clade nodes, {len(tree.tips)} tips", flush=True)

group_aliases = paraphyletic.apply_groups(tree)  # virtual "Fox" etc.
print(f"paraphyletic: {len(group_aliases)} virtual group nodes", flush=True)

ptaxa = pool.select_pool(tree)  # all non-extinct
print(f"pool: {len(ptaxa)} playable tips", flush=True)

provider = enrich.BraidworksProvider()
print("enrich: harvesting species names from Wikidata…", flush=True)
enriched = enrich.enrich(ptaxa, provider)  # harvests all species
print(f"  {time.time()-t0:.0f}s — harvesting clade-node names…", flush=True)
node_names = enrich.enrich_clade_nodes(tree, provider)  # harvests ALL clade nodes
print(f"  {len(node_names)} clade nodes got names ({time.time()-t0:.0f}s)", flush=True)

doc = asset.build_asset(
    tree, enriched, node_names=node_names, group_aliases=group_aliases, scope="class=Mammalia"
)
validate.validate_asset(doc)
asset.write_asset(doc, out)
print(f"asset: pool_size={doc['pool_size']}, nodes={len(doc['nodes'])}, "
      f"aliases={len(doc['aliases'])} ({time.time()-t0:.0f}s)", flush=True)

# Coverage: how many tips / clade nodes resolved beyond a bare scientific name?
from pipeline.enrich import normalize
al = doc["aliases"]
tips = doc["tips"]
common_tips = sum(1 for t in tips if t["common"] != t["sci"])
print(f"coverage: {common_tips}/{len(tips)} tips have a common display name "
      f"({100*common_tips/len(tips):.1f}%)", flush=True)
named_nodes = sum(1 for n in doc["nodes"] if n.get("common"))
print(f"          {named_nodes}/{len(doc['nodes'])} clade nodes have a common name "
      f"({100*named_nodes/len(doc['nodes']):.1f}%)", flush=True)

# Spot-check the cases the user cares about.
checks = ["anteater", "sloth", "armadillo", "bear", "panda bear", "river otter",
          "giant panda", "lion", "blue whale",
          "fox", "foxes", "vixen", "vulpes", "red fox", "silver fox"]
print("--- resolution spot-check ---", flush=True)
nodes = {n["id"]: n for n in doc["nodes"]}
tipmap = {t["id"]: t for t in tips}
for q in checks:
    hit = al.get(normalize(q))
    if hit:
        labels = [(nodes.get(h) or tipmap.get(h))["sci"] for h in hit]
        print(f"  {q:14} -> {labels}", flush=True)
    else:
        print(f"  {q:14} -> None", flush=True)
print(f"DONE in {time.time()-t0:.0f}s", flush=True)
