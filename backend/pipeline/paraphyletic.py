"""
Stage 3.5 — virtual clade nodes for paraphyletic / vague common names.

A name like "fox" doesn't map to one clade: true foxes (*Vulpes*), gray foxes
(*Urocyon*) and the South American foxes (*Lycalopex*, *Cerdocyon*, *Atelocynus*,
*Otocyon*) are scattered across Canidae. Resolving "fox" to any one of them is
arbitrary (the bug we hit), and there is no real clade to point at.

The reference (animalist) solves this by hand-building a virtual "Fox" node under
Canidae and re-parenting the fox taxa beneath it. We do the same, from a small curated
list. Each entry inserts a synthetic ``grp:<Title>`` node and moves its members under
it, so the group name resolves to one clean, placeable node that owns those aliases
exclusively (the asset claims the keys so members can't also answer to "fox").

Wikipedia's ``{{Paraphyletic group}}`` template (241 of them) could automate the long
tail later; this curated set covers the names players actually type.
"""
from __future__ import annotations

from .types import Node, Tree

# title:    display name + scientific-name slug for the virtual node
# aliases:  every typed form that should resolve to it (plurals are baked later)
# parent:   scientific name of the real clade to hang the group under
# members:  scientific names (genera or species) to re-parent beneath the group
GROUPS: list[dict] = [
    {
        "title": "Fox",
        "aliases": ["fox", "foxes", "vixen"],
        "parent": "Canidae",
        "members": ["Vulpes", "Urocyon", "Lycalopex", "Cerdocyon", "Atelocynus", "Otocyon"],
    },
]


def apply_groups(tree: Tree, groups: list[dict] | None = None) -> dict[str, list[str]]:
    """Insert curated virtual group nodes into the backbone and re-parent their members.

    Mutates ``tree.nodes`` in place; returns ``group_node_id -> [alias names]`` so the
    asset builder can give the group exclusive ownership of those names. A group whose
    parent or all members are out of the loaded scope is skipped.
    """
    groups = GROUPS if groups is None else groups

    # First node id seen for a scientific name (genus/family names are unique in scope).
    sci_to_node: dict[str, str] = {}
    for node_id, node in tree.nodes.items():
        sci_to_node.setdefault(node.sci, node_id)

    group_aliases: dict[str, list[str]] = {}
    for g in groups:
        parent_id = sci_to_node.get(g["parent"])
        if parent_id is None:
            continue
        member_ids = [sci_to_node[m] for m in g["members"] if m in sci_to_node]
        if not member_ids:
            continue

        gid = "grp:" + g["title"].replace(" ", "_")
        tree.nodes[gid] = Node(
            id=gid, rank="group", sci=g["title"], common=g["title"], parent=parent_id
        )
        for member_id in member_ids:
            tree.nodes[member_id].parent = gid

        # The group owns its own title plus the listed aliases (deduped).
        group_aliases[gid] = list(dict.fromkeys([g["title"], *g["aliases"]]))

    return group_aliases
