Cladewright — build spec

A daily phylogenetics guessing site. Two games sharing one tree-of-life renderer. Aesthetic: clean, museum-like; both common + scientific names shown everywhere. Responsive (desktop + mobile). Expandable from animals to all organisms later.
Data

    Source: Catalogue of Life or NCBI Taxonomy. Need, per taxon: common name, scientific name, full lineage (ranked ancestors), and parent/child links so you can compute the most-recent common ancestor (MRCA) between any two taxa and count of sister taxa under any internal node.
    Precompute a tree structure; store each node's child count at every rank.

Shared component: TreeRenderer

    Radial layout primary (rectangular as an optional setting). Only renders nodes the player has unlocked — never the full 400+ tips at once (progressive disclosure).
    Node types: found tip (solid circle + common name bold, scientific italic below); internal clade node (accent dot + clade name); ghost/hidden-sister slot (dashed circle with an on-branch label like "3 sisters hidden" — count only, never names).
    Zoom + pan: scroll/pinch to zoom, drag to pan, "fit" button. Zoom in as a clade densifies.
    Two hint-label styles to A/B test: ① dashed node + "?" + count, ② grey silhouette blob + count.

Game 1 — Classic (Metazooa-style daily)

    One mystery animal/day. Player guesses; autocomplete restricts to real taxa (typos don't count).
    Each guess places the MRCA of guess + answer as a node on the tree; show guess history with a proximity bar (closer ancestor = warmer/fuller bar) + rank label.
    Limited guesses. Win = correct guess.
    (This is intentionally close to Metazooa — iterate later.)

Game 2 — Marathon (the novel one; everything happens on the tree)

    Merge of "list as many" + "build the tree." No side panels — the tree canvas is the UI.
    Floating top HUD over the canvas: countdown timer, text input ("name an organism — it lands on the tree"), live count.
    Timer mechanic: start ~60s; each valid new organism adds time (more for rarer clades). Run out = game over. Score = tips placed.
    Each valid organism sprouts on the shared tree and reveals its empty sister-slots with on-branch "N sisters hidden" labels (count only).
    Optional: a "trait?" reveal that spends time/points to surface a vague clue for a hidden slot (no name).
