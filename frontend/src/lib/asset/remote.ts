// Remote name source for huge-scope mode: the client talks to /search (autocomplete)
// and /resolve (one organism's lineage) instead of holding the whole alias index +
// tree. Kept deliberately light on the server (see AGENTS.md):
//   * resolveRemote() CACHES per (scope,id) — an organism's immutable lineage is
//     fetched at most once per session, then lives in the grown asset.
//   * search is debounced by the caller (the search box), not fired per keystroke.

import type { ResolvePayload } from "./growable";

const API = import.meta.env.VITE_API_BASE ?? "/api/gamedata";

/** One autocomplete candidate (matches SearchView's payload). */
export interface SearchHit {
  name: string;
  id: string;
  kind: "tip" | "node";
  sci: string;
  common: string | null;
}

function scoped(path: string, scope: string | undefined, params: Record<string, string>): string {
  const u = new URLSearchParams(params);
  if (scope) u.set("scope", scope);
  return `${API}/${path}/?${u.toString()}`;
}

/** Autocomplete candidates for a typed query. Returns [] on empty/failed query. */
export async function searchRemote(
  scope: string | undefined,
  q: string,
  limit = 12,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const query = q.trim();
  if (!query) return [];
  try {
    const res = await fetch(scoped("search", scope, { q: query, limit: String(limit) }), { signal });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []) as SearchHit[];
  } catch {
    return []; // aborted or network error — caller treats as "no results yet"
  }
}

// Per-(scope,id) cache: an immutable resolve is fetched once, then reused forever.
const resolveCache = new Map<string, Promise<ResolvePayload | null>>();

/** Fetch one organism's target + denormalized lineage, cached. null if not found. */
export function resolveRemote(scope: string | undefined, id: string): Promise<ResolvePayload | null> {
  const key = `${scope ?? ""}:${id}`;
  const hit = resolveCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await fetch(scoped("resolve", scope, { id }));
      if (!res.ok) return null;
      return (await res.json()) as ResolvePayload;
    } catch {
      return null;
    }
  })();
  resolveCache.set(key, p);
  return p;
}
