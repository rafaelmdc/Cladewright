// Remote name source for huge-scope mode: the client talks to /search (autocomplete)
// and /resolve (one organism's lineage) instead of holding the whole alias index +
// tree. Kept deliberately light on the server (see AGENTS.md):
//   * resolveRemote() CACHES per (scope,id) — an organism's immutable lineage is
//     fetched at most once per session, then lives in the grown asset.
//   * search is debounced by the caller (the search box), not fired per keystroke.

import type { ResolvePayload } from "./growable";
import { parseFilter, type FuseFilter } from "./membership";

const API = import.meta.env.VITE_API_BASE ?? "/api/gamedata";

/** One autocomplete candidate (matches SearchView's payload). */
export interface SearchHit {
  name: string;
  id: string;
  kind: "tip" | "node";
  sci: string;
  common: string | null;
}

function scoped(
  path: string,
  scope: string | undefined,
  params: Record<string, string>,
  version?: number,
): string {
  const u = new URLSearchParams(params);
  if (scope) u.set("scope", scope);
  // Pin the asset version so the response is immutable and the CDN can cache it forever
  // (Cloudflare pull-through). Omitted (0/undefined) → the server serves "current".
  if (version) u.set("v", String(version));
  return `${API}/${path}/?${u.toString()}`;
}

/** Autocomplete candidates for a typed query. Returns [] on empty/failed query. */
export async function searchRemote(
  scope: string | undefined,
  q: string,
  version?: number,
  limit = 12,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const query = q.trim();
  if (!query) return [];
  try {
    const res = await fetch(scoped("search", scope, { q: query, limit: String(limit) }, version),
      { signal });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []) as SearchHit[];
  } catch {
    return []; // aborted or network error — caller treats as "no results yet"
  }
}

// Tail name→id resolution is a STATIC, edge-cacheable prefix shard (exact-match input, no
// fuzzy autocomplete), not the live substring /search. The client fetches one shard per key
// prefix and looks the typed name up locally.
const SHARD_PREFIX_LEN = 3;
const shardCache = new Map<string, Promise<Record<string, string[]>>>();

/** The shard key prefix for a normalized query (its first few chars; the whole thing when
 *  shorter). Shared across all queries with that prefix, so the shard is fetched once. */
export function shardPrefix(norm: string): string {
  return norm.slice(0, SHARD_PREFIX_LEN);
}

/** Fetch one alias shard `{norm: [ids]}` for a prefix, cached per (scope, version, prefix). */
export function fetchShard(
  scope: string | undefined,
  version: number | undefined,
  prefix: string,
): Promise<Record<string, string[]>> {
  const key = `${scope ?? ""}:${version ?? 0}:${prefix}`;
  const hit = shardCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await fetch(scoped("idx", scope, { p: prefix }, version));
      if (!res.ok) return {};
      return ((await res.json()).keys ?? {}) as Record<string, string[]>;
    } catch {
      return {};
    }
  })();
  shardCache.set(key, p);
  return p;
}

/** Fetch + parse the scope's binary-fuse8 membership filter (version-pinned, cacheable).
 *  null when the scope has none (whole-pool blob) or the fetch fails — callers then just
 *  skip the local reject and fall through to /search. */
export async function fetchFilter(
  scope: string | undefined,
  version?: number,
): Promise<FuseFilter | null> {
  try {
    const res = await fetch(scoped("filter", scope, {}, version));
    if (!res.ok) return null;
    return parseFilter(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// Per-(scope,version,id) cache: an immutable resolve is fetched once, then reused forever.
const resolveCache = new Map<string, Promise<ResolvePayload | null>>();

/** Fetch one organism's target + denormalized lineage, cached. null if not found. */
export function resolveRemote(
  scope: string | undefined,
  id: string,
  version?: number,
): Promise<ResolvePayload | null> {
  const key = `${scope ?? ""}:${version ?? 0}:${id}`;
  const hit = resolveCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await fetch(scoped("resolve", scope, { id }, version));
      if (!res.ok) return null;
      return (await res.json()) as ResolvePayload;
    } catch {
      return null;
    }
  })();
  resolveCache.set(key, p);
  return p;
}
