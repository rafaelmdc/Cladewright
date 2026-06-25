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

/** Resolve an exact typed name to its full placement payload (target + trimmed lineage) in
 *  ONE call. The server does an exact-equality lookup on the (asset, norm) btree — O(log n),
 *  scalable to any table size, never a fuzzy/prefix scan — then returns the same payload as
 *  resolveRemote. Immutable + cached per (scope, version, name). null on a miss. */
export function resolveByName(
  scope: string | undefined,
  q: string,
  version?: number,
): Promise<ResolvePayload | null> {
  const key = `${scope ?? ""}:${version ?? 0}:q:${q}`;
  const hit = resolveCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await fetch(scoped("resolve", scope, { q }, version));
      if (!res.ok) return null;
      return (await res.json()) as ResolvePayload;
    } catch {
      return null;
    }
  })();
  resolveCache.set(key, p);
  return p;
}
