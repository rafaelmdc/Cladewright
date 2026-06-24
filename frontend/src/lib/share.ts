// Self-contained run-result sharing (#74). A result is encoded straight into the share URL's
// hash, so opening the link renders entirely client-side — nothing is stored or queried
// server-side (most players never open a shared link, so persisting every result would be
// wasteful). It's a brag card, not the leaderboard: the real ranking stays server-
// authoritative, so a hand-edited share URL fools no one who matters.

import type { Difficulty } from "./scores";

export interface ShareData {
  user: string;
  score: number;
  animals: number; // distinct species named
  scope: string; // scope label, e.g. "Birds"
  difficulty: Difficulty;
  rank: number | null;
}

/** Compact `key=value` hash for the share URL. Short keys keep the link tidy. */
export function encodeShare(d: ShareData): string {
  const p = new URLSearchParams({
    u: d.user,
    s: String(d.score),
    a: String(d.animals),
    g: d.scope,
    d: d.difficulty,
  });
  if (d.rank != null) p.set("r", String(d.rank));
  return p.toString();
}

/** Parse a share hash back into ShareData, or null if it's absent/malformed. */
export function decodeShare(hash: string): ShareData | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  if (!p.has("s")) return null;
  const diff = p.get("d") === "scientific" ? "scientific" : "common";
  return {
    user: p.get("u") || "a naturalist",
    score: Number(p.get("s")) || 0,
    animals: Number(p.get("a")) || 0,
    scope: p.get("g") || "",
    difficulty: diff,
    rank: p.has("r") ? Number(p.get("r")) : null,
  };
}

/** The full shareable URL for a result. */
export function shareUrlFor(d: ShareData): string {
  return `${window.location.origin}/r#${encodeShare(d)}`;
}
