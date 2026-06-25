"""
Stage 4 — enrich with common names.

CoL VernacularName (Stage 1) covers famous animals but leaves gaps. The real
implementation closes those via a **Braidworks** weaver: wikidata vernacular +
enwiki title + P13176 common-name items fill the name gaps that make natural-name
resolution feel right. Display-name precedence: CoL vernacular → Wikidata →
scientific. See docs/data-pipeline.md §Stage 4.

(The popularity/obscurity "fame" system — Wikipedia pageviews driving time bonuses —
is post-MVP and intentionally not built here; the pool is all species, so nothing
gates inclusion on fame.)

Until the weaver is installed, a deterministic offline provider keeps the whole
pipeline runnable and reproducible. Swap in the Braidworks-backed provider by passing
one to `enrich`.
"""
from __future__ import annotations

import re
from collections.abc import Callable
from typing import Protocol

from .types import EnrichedTip, Taxon, Tree

_WS = re.compile(r"[\s_]+")  # underscores count as spaces (Wikipedia titles use them)
_PUNCT = re.compile(r"[^\w\s]")


def despace(name: str) -> str:
    """Turn a Wikipedia-style title into a display name: 'Brown_bear' -> 'Brown bear'."""
    return name.replace("_", " ").strip()


# A Wikidata altLabel like "Vulpes Frisch, 1775" or "Canis (Linnaeus, 1758)" is a
# scientific-name-with-authority, not a common name — junk for display. Drop anything
# ending in an author-year citation. (These still make fine *alias* keys; we only keep
# them out of the chosen DISPLAY name.)
_AUTHORITY_RE = re.compile(r",\s*\d{3,4}\)?\s*$")


def is_junk_name(name: str) -> bool:
    """True if a string is an authority citation rather than a usable common name."""
    return bool(_AUTHORITY_RE.search(name.strip()))


def normalize(name: str) -> str:
    """Lowercase, drop punctuation, fold underscores+whitespace — the alias-index key.

    Players type natural names ('brown bear'), never underscores, so any underscore in
    a source string must collapse to a space for the lookup to match.
    """
    return _WS.sub(" ", _PUNCT.sub("", name.lower().replace("_", " "))).strip()


def _singularize(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"  # wallabies -> wallaby
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]  # bears -> bear, whales -> whale
    return word


def _pluralize(word: str) -> str:
    if word.endswith(("s", "x", "z", "ch", "sh")):
        return word + "es"
    if len(word) > 1 and word.endswith("y") and word[-2] not in "aeiou":
        return word[:-1] + "ies"  # wallaby -> wallabies
    return word + "s"


def index_keys(name: str) -> list[str]:
    """Alias-index keys for a name: its normalized form PLUS the singular/plural of the
    last word. Baking both forms at build time means resolution is a single O(1)
    ``normalize(query)`` lookup that matches either form — without de-pluralizing (and
    mangling) scientific names, since the original is always kept. Plurals sit on the
    last word ("polar bears" -> "polar bear")."""
    base = normalize(name)
    if not base:
        return []
    parts = base.split(" ")
    last = parts[-1]
    keys = {base}
    for variant in (_singularize(last), _pluralize(last)):
        if variant != last:
            keys.add(" ".join(parts[:-1] + [variant]))
    return sorted(keys)


class EnrichProvider(Protocol):
    """How the pipeline reaches common names. Implemented by Braidworks.

    ``prepare`` is an optional batch hook: a provider that fans out over a network
    (Braidworks) runs the whole batch once and caches, so the per-taxon
    ``common_name`` / ``names`` calls are then local lookups.
    """

    def prepare(self, taxa: list[Taxon]) -> None: ...
    def harvest(
        self, scientific_names: list[str], ranks: dict[str, str] | None = None,
        *, phase: str = "names",
    ) -> None: ...
    def harvest_fame(self, scientific_names: list[str]) -> None: ...
    def fame_for(self, scientific_name: str) -> int: ...
    def names_for(self, scientific_name: str) -> list[str]: ...
    def common_name(self, taxon: Taxon) -> str | None: ...
    def names(self, taxon: Taxon) -> list[str]: ...


class OfflineProvider:
    """Deterministic, network-free default. Common name is whatever CoL vernacular
    provided (no Wikidata fallback offline)."""

    def prepare(self, taxa: list[Taxon]) -> None:
        return None

    def harvest(
        self, scientific_names: list[str], ranks: dict[str, str] | None = None,
        *, phase: str = "names",
    ) -> None:
        return None  # offline has no name source beyond CoL vernacular

    def harvest_fame(self, scientific_names: list[str]) -> None:
        return None  # offline has no popularity signal

    def fame_for(self, scientific_name: str) -> int:
        return 0

    def names_for(self, scientific_name: str) -> list[str]:
        return []

    def common_name(self, taxon: Taxon) -> str | None:
        return despace(taxon.vernacular) if taxon.vernacular else None

    def names(self, taxon: Taxon) -> list[str]:
        """All name strings for the alias index (offline: CoL vernacular + subspecies names)."""
        out = [taxon.vernacular] if taxon.vernacular else []
        out.extend(taxon.extra_aliases)
        return [despace(n) for n in out]


class BraidworksProvider:
    """Real enrichment via Braidworks: organism.scientific_name -> names for the alias
    index (Wikidata label/altLabel/vernacular, enwiki title, P13176 common-name items),
    in one batched braid. Requires ``wikidata_weaver`` installed; see
    backend/pipeline/README.md. (Pageviews/fame are out of MVP scope — names only.)

    Call ``prepare(taxa)`` once before ``common_name`` / ``names`` (the pipeline does).
    """

    def __init__(
        self,
        *,
        fame_dump_path: str | None = None,
        fame_year: int | None = None,
        fame_month: int | None = None,
        progress: Callable[[str, int, int], None] | None = None,
    ) -> None:
        self._cache: dict[str, list[str]] = {}  # scientific_name -> [name strings]
        self._title: dict[str, str] = {}  # scientific_name -> enwiki article title
        self._pageviews: dict[str, int] = {}  # scientific_name -> enwiki pageviews
        self._sitelinks: dict[str, int] = {}  # scientific_name -> wikidata sitelink count
        # When a dump is configured, fame uses the local (dump) pageviews backend — the
        # one that scales to million-title scopes; otherwise the keyless REST api backend
        # (fine for the few-thousand-title current scopes). See wikipedia_weaver.
        self._fame_dump_path = fame_dump_path
        self._fame_year = fame_year
        self._fame_month = fame_month
        # Optional progress sink (phase, done, total) so a long network harvest reports
        # incrementally instead of going silent for minutes. Set by build_gamedata so the
        # admin job log ticks up.
        self._progress = progress

    # Aim for ~20 progress ticks over a harvest regardless of pool size (≥200/chunk so each
    # network round-trip still batches usefully — the wikidata weaver chunks VALUES at 200).
    @staticmethod
    def _chunk_size(total: int) -> int:
        return max(200, (total + 19) // 20)

    def prepare(self, taxa: list[Taxon]) -> None:
        # Pool taxa are accepted species, so the homonym disambiguator is "species".
        self.harvest(
            [t.scientific_name for t in taxa],
            ranks={t.scientific_name: "species" for t in taxa},
        )

    def harvest(
        self, scientific_names: list[str], ranks: dict[str, str] | None = None,
        *, phase: str = "names",
    ) -> None:
        """Pull Wikidata names for any names not yet cached. Reusable for species AND
        clade nodes — the reference resolves group names ("bear", "seal") because it
        harvests higher taxa too.

        ``ranks`` (scientific_name -> taxon rank) is accepted for call-site compatibility but
        currently unused: the wikidata weaver's resolve_taxon takes no rank parameter, so a
        cross-code homonym is resolved by Wikidata's own P225 match. (Earlier code passed an
        ``expected_rank`` param, but the weaver never consumed it — newer braidworks-core
        rejects unknown params, so it's dropped.)"""
        import asyncio

        from braidworks.core import Braider, LocalExecutor, Strand, StrandSet
        from braidworks.core.discovery import build_registry_from_entry_points

        todo = sorted({n for n in scientific_names if n and n not in self._cache})
        if not todo:
            return

        # wikipedia.title is the enwiki article title — the reference's *primary* alias
        # source ("Hyena" for Hyaenidae). wikidata produces it for free.
        registry = build_registry_from_entry_points(only=frozenset({"wikidata"}))
        braid = Braider(registry).plan(
            available_types=frozenset({"organism.scientific_name"}),
            target_types=frozenset({"organism.vernacular_names", "wikipedia.title"}),
        )
        executor = LocalExecutor(registry)

        async def run_all() -> None:
            # ONE event loop (one asyncio.run): the backend's async HTTP client is cached on
            # the registry's backend, so a second asyncio.run() would bind it to a closed
            # loop. We still chunk WITHIN this loop — sequential awaits reuse the same client
            # — so a long harvest reports progress instead of going silent for minutes.
            total = len(todo)
            chunk = self._chunk_size(total)
            done = 0
            for start in range(0, total, chunk):
                names = todo[start : start + chunk]
                inputs = [
                    StrandSet.from_strands(name, [Strand("organism.scientific_name", name)])
                    for name in names
                ]
                result = await executor.execute(braid, inputs)
                for ss in result.resolved:
                    name_strand = ss.get("organism.scientific_name")
                    if name_strand is None:
                        continue
                    vn_strand = ss.get("organism.vernacular_names")
                    title_strand = ss.get("wikipedia.title")
                    # Title first — it's the cleanest common name (and the canonical display,
                    # following the reference). Kept separately too so display never falls
                    # back to non-deterministic SPARQL ordering of altLabels.
                    harvested = [title_strand.value] if title_strand else []
                    harvested += list(vn_strand.value) if vn_strand else []
                    # dedup preserving order (the title often repeats a vernacular).
                    self._cache[name_strand.value] = list(dict.fromkeys(harvested))
                    if title_strand:
                        self._title[name_strand.value] = title_strand.value
                done += len(names)
                if self._progress:
                    self._progress(phase, done, total)

        asyncio.run(run_all())

    def harvest_fame(self, scientific_names: list[str]) -> None:
        """Pull a popularity score for each pool species: enwiki pageviews (primary) and
        Wikidata sitelink count (fallback). One braid chains scientific_name → enwiki
        title → pageviews, and the same item yields its sitelink count. Cached, so a
        re-run is a no-op for names already scored."""
        import asyncio

        from braidworks.core import Braider, LocalExecutor, Strand, StrandSet
        from braidworks.core.discovery import build_registry_from_entry_points

        todo = sorted(
            {n for n in scientific_names if n and n not in self._pageviews and n not in self._sitelinks}
        )
        if not todo:
            return

        # Dump-configured → register the local (dump) pageviews backend; else the keyless
        # REST api via entry points (right tool for the current few-thousand-title scopes).
        if self._fame_dump_path or (self._fame_year and self._fame_month):
            from wikipedia_weaver.factory import build_wikipedia_weaver

            registry = build_registry_from_entry_points(only=frozenset({"wikidata"}))
            registry.register(
                build_wikipedia_weaver(
                    dump_path=self._fame_dump_path,
                    year=self._fame_year,
                    month=self._fame_month,
                    auto_setup=True,
                )
            )
        else:
            registry = build_registry_from_entry_points(
                only=frozenset({"wikidata", "wikipedia"})
            )

        braid = Braider(registry).plan(
            available_types=frozenset({"organism.scientific_name"}),
            target_types=frozenset({"wikipedia.pageviews", "wikidata.sitelinks"}),
        )
        executor = LocalExecutor(registry)

        async def run_all() -> None:
            # Chunk within the one event loop (see harvest()) so fame reports progress.
            total = len(todo)
            chunk = self._chunk_size(total)
            done = 0
            for start in range(0, total, chunk):
                names = todo[start : start + chunk]
                inputs = [
                    StrandSet.from_strands(name, [Strand("organism.scientific_name", name)])
                    for name in names
                ]
                result = await executor.execute(braid, inputs)
                for ss in result.resolved:
                    name_strand = ss.get("organism.scientific_name")
                    if name_strand is None:
                        continue
                    name = name_strand.value
                    pv = ss.get("wikipedia.pageviews")
                    sl = ss.get("wikidata.sitelinks")
                    if pv is not None and pv.value is not None:
                        self._pageviews[name] = int(pv.value)
                    if sl is not None and sl.value is not None:
                        self._sitelinks[name] = int(sl.value)
                done += len(names)
                if self._progress:
                    self._progress("fame", done, total)

        asyncio.run(run_all())

    def fame_for(self, scientific_name: str) -> int:
        """Popularity score: enwiki pageviews if known, else the Wikidata sitelink count,
        else 0. Pageviews dwarf sitelink counts, so any taxon with a real enwiki article
        outranks sitelink-only taxa — exactly the intended ordering."""
        pv = self._pageviews.get(scientific_name)
        if pv:
            return pv
        return self._sitelinks.get(scientific_name, 0)

    def names_for(self, scientific_name: str) -> list[str]:
        """Harvested names for any scientific name (species or clade), despaced."""
        return [despace(n) for n in self._cache.get(scientific_name, [])]

    def display_for(self, scientific_name: str, vernacular: str | None = None) -> str | None:
        """The clean DISPLAY name. Mirrors the reference, which makes the enwiki article
        title the canonical common name ("Red fox", not the "Silver Fox" altLabel) —
        EXCEPT when that title is just the binomial (obscure species whose article is
        titled with the Latin name), where a real vernacular reads better.

        Precedence: enwiki title (if it's a real common name) → CoL vernacular → first
        non-binomial non-junk harvested name → the binomial title as a last resort.
        """
        sci_key = normalize(scientific_name)

        def usable(name: str | None) -> bool:
            return bool(name) and not is_junk_name(name) and normalize(name) != sci_key

        title = self._title.get(scientific_name)
        if usable(title):
            return despace(title)
        if usable(vernacular):
            return despace(vernacular)
        for n in self._cache.get(scientific_name, []):
            if usable(n):
                return despace(n)
        # Nothing better than the Latin name itself — return the title if we have one
        # (it equals the binomial) so callers still get a value, else None.
        return despace(title) if title and not is_junk_name(title) else None

    def common_name(self, taxon: Taxon) -> str | None:
        return self.display_for(taxon.scientific_name, taxon.vernacular)

    def names(self, taxon: Taxon) -> list[str]:
        """Every harvested name + CoL vernacular + subspecies vernaculars, despaced — the
        colloquial aliases that make resolution feel right."""
        names = list(self._cache.get(taxon.scientific_name, []))
        if taxon.vernacular:
            names.append(taxon.vernacular)
        names.extend(taxon.extra_aliases)
        return [despace(n) for n in names]


def enrich(pool_taxa: list[Taxon], provider: EnrichProvider | None = None) -> list[EnrichedTip]:
    provider = provider or OfflineProvider()
    provider.prepare(pool_taxa)  # no-op if already prepared
    provider.harvest_fame([t.scientific_name for t in pool_taxa])  # popularity scores
    out: list[EnrichedTip] = []
    for taxon in pool_taxa:
        # Display name precedence: CoL/Wikidata vernacular → scientific.
        common = provider.common_name(taxon) or taxon.scientific_name

        # Alias set: scientific name + common name + every harvested name string
        # (Wikidata label/altLabel/vernacular: "panda bear", "the lion", …), all
        # normalized. This is what makes natural-name resolution work.
        keys = {normalize(common), normalize(taxon.scientific_name)}
        keys.update(normalize(n) for n in provider.names(taxon))
        aliases = sorted(keys - {""})

        out.append(EnrichedTip(
            taxon=taxon, common=common, aliases=aliases,
            fame=provider.fame_for(taxon.scientific_name),
        ))
    return out


def enrich_clade_nodes(tree: Tree, provider: EnrichProvider | None = None) -> dict[str, list[str]]:
    """Harvest common names for internal clade nodes so group names resolve —
    "bear" → Ursidae, "whale" → Cetacea, "sloth" → Folivora. The reference does this
    by harvesting names for every taxon (not just species); we do the same on our
    backbone's clade scientific names. Returns node_id → harvested name strings.
    """
    provider = provider or OfflineProvider()
    sci_to_nodes: dict[str, list[str]] = {}
    node_rank: dict[str, str] = {}
    for node in tree.nodes.values():
        sci_to_nodes.setdefault(node.sci, []).append(node.id)
        node_rank.setdefault(node.sci, node.rank)  # rank disambiguates homonym clades

    provider.harvest(list(sci_to_nodes), ranks=node_rank, phase="clade names")

    node_names: dict[str, list[str]] = {}
    for sci, node_ids in sci_to_nodes.items():
        names = provider.names_for(sci)
        if names:
            for node_id in node_ids:
                node_names[node_id] = names
    return node_names
