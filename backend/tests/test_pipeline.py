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


def test_fame_flows_into_asset(coldp_dir: Path):
    """A provider's fame score lands on each tip; tips with no signal default to 0."""

    class FameProvider(enrich.OfflineProvider):
        FAME = {"Ursus arctos": 5000, "Panthera leo": 9000}

        def fame_for(self, scientific_name: str) -> int:
            return self.FAME.get(scientific_name, 0)

    taxa = ingest.ingest_coldp(coldp_dir, scope="kingdom=Animalia")
    tree = backbone.build_backbone(taxa)
    enriched = enrich.enrich(pool.select_pool(tree), FameProvider())
    doc = assetmod.build_asset(tree, enriched, scope="kingdom=Animalia")
    validate.validate_asset(doc)
    tips = {t["id"]: t for t in doc["tips"]}
    assert tips["tip:Panthera_leo"]["fame"] == 9000
    assert tips["tip:Ursus_arctos"]["fame"] == 5000
    assert tips["tip:Ursus_maritimus"]["fame"] == 0  # no signal → 0


def test_offline_enrich_fame_is_zero(coldp_dir: Path):
    """The default offline provider has no popularity signal, so fame is 0 everywhere."""
    doc = build(coldp_dir, size=100, clade_floor=10)
    assert all(t["fame"] == 0 for t in doc["tips"])


@pytest.mark.parametrize(
    "common,sci,expected",
    [
        # the real thing
        ("Red fox", "Vulpes vulpes", True),
        ("bright goby", "Ilypnus luculentus", True),
        # a common name that merely LOOKS binomial — the second word is not the epithet
        ("Manta ray", "Mobula birostris", True),
        ("Sulfurhead aulonocara", "Aulonocara maylandi", True),
        # the pipeline's own fallback (#145's reported example)
        ("Oxyeleotris herwerdenii", "Oxyeleotris herwerdenii", False),
        (None, "Vulpes vulpes", False),
        # a synonym binomial harvested from Wikidata as a "vernacular"
        ("Melanochromis labrosus", "Abactochromis labrosus", False),
        # a vernacular in another script
        ("キビレマツカサ", "Myripristis chryseres", False),
        # a Wikipedia title's disambiguator, which is not a name anyone says
        ("Pholidota (plant)", "Pholidota", False),
    ],
)
def test_has_vernacular_recognises_real_common_names(common, sci, expected):
    """#145: `common` falls back to the binomial, so "has a common name" has to be its own
    boolean — and three different things masquerade as vernaculars in the harvest."""
    assert enrich.has_vernacular(common, sci) is expected


def test_has_common_flag_lands_on_every_tip(coldp_dir: Path):
    """The flag is baked per tip, and agrees with the display name it describes."""
    doc = build(coldp_dir, size=100, clade_floor=10)
    for tip in doc["tips"]:
        assert isinstance(tip["has_common"], bool)
        # False must mean the display name fell back to the binomial.
        if not tip["has_common"]:
            assert tip["common"] == tip["sci"] or not enrich.has_vernacular(
                tip["common"], tip["sci"]
            )


def test_has_image_is_omitted_when_the_build_could_not_look(coldp_dir: Path):
    """Offline builds have no way to ask Wikipedia. The flag is then ABSENT rather than
    False — the client treats absent as "check for me" and False as "don't draw this"."""
    doc = build(coldp_dir, size=100, clade_floor=10)
    assert all("has_image" not in t for t in doc["tips"])


def test_has_image_is_baked_when_the_provider_knows(coldp_dir: Path):
    class PicturedProvider(enrich.OfflineProvider):
        def has_image(self, scientific_name: str) -> bool | None:
            return scientific_name == "Panthera leo"

    taxa = ingest.ingest_coldp(coldp_dir, scope="kingdom=Animalia")
    tree = backbone.build_backbone(taxa)
    enriched = enrich.enrich(pool.select_pool(tree), PicturedProvider())
    doc = assetmod.build_asset(tree, enriched, scope="kingdom=Animalia")
    validate.validate_asset(doc)
    tips = {t["id"]: t for t in doc["tips"]}
    assert tips["tip:Panthera_leo"]["has_image"] is True
    assert tips["tip:Ursus_arctos"]["has_image"] is False


def _hybrid_doc() -> dict:
    return {
        "version": 1, "schema": "1.0", "scope": "bugs", "pool_size": 3,
        "nodes": [
            {"id": "kng:Animalia", "rank": "kingdom", "sci": "Animalia", "parent": None,
             "pool_count": 3},
            {"id": "fam:Aidae", "rank": "family", "sci": "Aidae", "parent": "kng:Animalia",
             "pool_count": 2},
            {"id": "gen:Apis", "rank": "genus", "sci": "Apis", "parent": "fam:Aidae",
             "pool_count": 2},
            {"id": "fam:Bidae", "rank": "family", "sci": "Bidae", "parent": "kng:Animalia",
             "pool_count": 1},
            {"id": "gen:Rarus", "rank": "genus", "sci": "Rarus", "parent": "fam:Bidae",
             "pool_count": 1},
        ],
        "tips": [
            {"id": "tip:famous", "sci": "Apis famous", "fame": 1000,
             "lineage": ["kng:Animalia", "fam:Aidae", "gen:Apis"]},
            {"id": "tip:mid", "sci": "Apis mid", "fame": 10,
             "lineage": ["kng:Animalia", "fam:Aidae", "gen:Apis"]},
            {"id": "tip:rare", "sci": "Rarus rare", "fame": 0,
             "lineage": ["kng:Animalia", "fam:Bidae", "gen:Rarus"]},
        ],
        "aliases": {"famous": ["tip:famous"], "rare": ["tip:rare"], "apis": ["gen:Apis"]},
    }


def test_notable_blob_coverage_frontier_and_aliases():
    blob = assetmod.build_notable_blob(_hybrid_doc(), coverage=0.9, min_tips=1, max_tips=2,
                                       frontier_rank="family")
    # Coverage 0.9 of fame mass (1010) is met by the single famous tip.
    assert [t["id"] for t in blob["tips"]] == ["tip:famous"]
    assert blob["notable_count"] == 1
    node_ids = {n["id"] for n in blob["nodes"]}
    # Every family ships (complete coarse backbone) so a tail species has a present anchor —
    # even fam:Bidae, whose only species (rare) is NOT in the blob.
    assert {"fam:Aidae", "fam:Bidae", "kng:Animalia"} <= node_ids
    # A genus ships only as an ancestor of a notable tip.
    assert "gen:Apis" in node_ids and "gen:Rarus" not in node_ids
    # Aliases are filtered to shipped targets.
    assert "famous" in blob["aliases"] and "apis" in blob["aliases"]
    assert "rare" not in blob["aliases"]
    # Pool counts stay FULL (the game counts against the whole tree).
    assert next(n for n in blob["nodes"] if n["id"] == "fam:Aidae")["pool_count"] == 2


def test_notable_blob_ships_whole_when_it_fits():
    doc = _hybrid_doc()
    # max=0 disables capping; a generous min also keeps the whole pool.
    assert assetmod.build_notable_blob(doc, max_tips=0) is doc
    assert assetmod.build_notable_blob(doc, coverage=0.9, min_tips=10, max_tips=20) is doc
