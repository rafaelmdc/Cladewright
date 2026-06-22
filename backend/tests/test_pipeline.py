"""End-to-end pipeline tests: ColDP dump -> validated game-data asset.

Pure-Python (no Django/DB needed). Covers ingest filtering, backbone shape, pool
selection rules, and asset/validate correctness — the Phase 1 contract.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from pipeline import asset as assetmod
from pipeline import backbone, enrich, ingest, pool, validate

NAME_USAGE_HEADER = "\t".join(
    [
        "col:ID", "col:status", "col:rank", "col:scientificName", "col:genericName",
        "col:specificEpithet", "col:environment", "col:extinct",
        "col:kingdom", "col:phylum", "col:class", "col:order", "col:family", "col:genus",
    ]
)

ROWS = [
    # id, status, rank, sci, genus, epithet, env, extinct, K, P, C, O, F, G
    ["A1", "accepted", "species", "Ursus arctos", "Ursus", "arctos", "terrestrial", "false",
     "Animalia", "Chordata", "Mammalia", "Carnivora", "Ursidae", "Ursus"],
    ["A2", "accepted", "species", "Ursus maritimus", "Ursus", "maritimus", "marine", "false",
     "Animalia", "Chordata", "Mammalia", "Carnivora", "Ursidae", "Ursus"],
    ["A3", "accepted", "species", "Panthera leo", "Panthera", "leo", "terrestrial", "false",
     "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Panthera"],
    ["A4", "accepted", "species", "Felis catus", "Felis", "catus", "terrestrial", "false",
     "Animalia", "Chordata", "Mammalia", "Carnivora", "Felidae", "Felis"],
    ["A5", "accepted", "species", "Corvus corax", "Corvus", "corax", "terrestrial", "false",
     "Animalia", "Chordata", "Aves", "Passeriformes", "Corvidae", "Corvus"],
    # dropped: synonym
    ["X1", "synonym", "species", "Ursus horribilis", "Ursus", "horribilis", "", "false",
     "Animalia", "Chordata", "Mammalia", "Carnivora", "Ursidae", "Ursus"],
    # kept at ingest, excluded at pool: extinct
    ["F1", "accepted", "species", "Tyrannosaurus rex", "Tyrannosaurus", "rex", "", "true",
     "Animalia", "Chordata", "Reptilia", "Saurischia", "Tyrannosauridae", "Tyrannosaurus"],
    # dropped: out of scope (Plantae)
    ["P1", "accepted", "species", "Quercus robur", "Quercus", "robur", "", "false",
     "Plantae", "Tracheophyta", "Magnoliopsida", "Fagales", "Fagaceae", "Quercus"],
]


@pytest.fixture
def coldp_dir(tmp_path: Path) -> Path:
    nu = tmp_path / "NameUsage.tsv"
    nu.write_text(NAME_USAGE_HEADER + "\n" + "\n".join("\t".join(r) for r in ROWS) + "\n")
    (tmp_path / "VernacularName.tsv").write_text(
        "col:taxonID\tcol:name\tcol:language\nA1\tbrown bear\teng\nA3\tlion\teng\n"
    )
    return tmp_path


def build(coldp_dir: Path, **kw) -> dict:
    taxa = ingest.ingest_coldp(coldp_dir, scope="kingdom=Animalia")
    tree = backbone.build_backbone(taxa)
    ptaxa = pool.select_pool(tree, **kw)
    enriched = enrich.enrich(ptaxa)
    doc = assetmod.build_asset(tree, enriched, scope="kingdom=Animalia")
    validate.validate_asset(doc)
    return doc


def test_ingest_filters_status_and_scope(coldp_dir: Path):
    taxa = ingest.ingest_coldp(coldp_dir, scope="kingdom=Animalia")
    names = {t.scientific_name for t in taxa}
    assert "Ursus arctos" in names
    assert "Tyrannosaurus rex" in names           # extinct kept at ingest
    assert "Ursus horribilis" not in names        # synonym dropped
    assert "Quercus robur" not in names           # out of scope


def test_ingest_attaches_side_tables(coldp_dir: Path):
    taxa = {t.source_id: t for t in ingest.ingest_coldp(coldp_dir)}
    assert taxa["A1"].vernacular == "brown bear"
    assert taxa["A2"].environment == ["marine"]
    assert taxa["F1"].extinct is True


def test_pool_excludes_extinct(coldp_dir: Path):
    doc = build(coldp_dir, size=100, clade_floor=10)
    sci = {t["sci"] for t in doc["tips"]}
    assert "Tyrannosaurus rex" not in sci
    assert doc["pool_size"] == 5


def test_pool_count_and_induced_backbone(coldp_dir: Path):
    doc = build(coldp_dir, size=100, clade_floor=10)
    nodes = {n["id"]: n for n in doc["nodes"]}
    assert nodes["ord:Carnivora"]["pool_count"] == 4
    assert nodes["fam:Ursidae"]["pool_count"] == 2
    assert nodes["kng:Animalia"]["pool_count"] == 5
    # The extinct T. rex branch is not pool-induced, so it isn't shipped.
    assert not any(n["rank"] == "class" and n["sci"] == "Reptilia" for n in doc["nodes"])


def test_common_name_precedence_and_aliases(coldp_dir: Path):
    doc = build(coldp_dir, size=100, clade_floor=10)
    tips = {t["id"]: t for t in doc["tips"]}
    assert tips["tip:Ursus_arctos"]["common"] == "brown bear"        # vernacular
    assert tips["tip:Ursus_maritimus"]["common"] == "Ursus maritimus"  # sci fallback
    assert doc["aliases"]["lion"] == ["tip:Panthera_leo"]
    assert doc["aliases"]["ursus arctos"] == ["tip:Ursus_arctos"]


def test_load_vernacular_is_english_only(tmp_path: Path):
    # CoL is Japanese-heavy for fish; a non-English vernacular here would become both the
    # displayed name and a search alias (the "スケトウダラ" bug). Keep English only.
    (tmp_path / "VernacularName.tsv").write_text(
        "col:taxonID\tcol:name\tcol:language\n"
        "G1\tスケトウダラ\tjpn\n"        # Japanese, listed first — must be ignored
        "G1\tAlaska pollock\teng\n"      # English — this is the one kept
        "G2\tクロマグロ\tjpn\n"          # Japanese-only — taxon gets NO CoL name (weaver fills)
        "G3\tWalleye\t\n"                # untagged — treated as English
    )
    v = ingest._load_vernacular(tmp_path)
    assert v["G1"] == "Alaska pollock"   # English wins over the earlier Japanese row
    assert "G2" not in v                 # no English → no CoL vernacular at all
    assert v["G3"] == "Walleye"


def test_clade_floor_guarantees_minimum_per_group(coldp_dir: Path):
    # size=1 but floor=1 at order level -> each order keeps at least one tip.
    doc = build(coldp_dir, size=1, clade_floor=1, floor_rank="order")
    orders_present = {
        n["sci"] for n in doc["nodes"] if n["rank"] == "order"
    }
    assert {"Carnivora", "Passeriformes"} <= orders_present


def test_validate_rejects_bad_pool_count(coldp_dir: Path):
    doc = build(coldp_dir, size=100, clade_floor=10)
    doc["nodes"][0]["pool_count"] += 1
    with pytest.raises(validate.AssetValidationError):
        validate.validate_asset(doc)


def test_build_is_deterministic(coldp_dir: Path):
    a = build(coldp_dir, size=100, clade_floor=10)
    b = build(coldp_dir, size=100, clade_floor=10)
    a["provenance"] = b["provenance"] = {}  # built_at timestamp is the only nondeterminism
    assert a == b
