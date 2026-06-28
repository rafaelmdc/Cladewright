// The scope catalog — what the picker renders. One entry per current build the backend
// serves, with its delivery mode (blob = download whole; remote = play incrementally).

const API = import.meta.env.VITE_API_BASE ?? "/api/gamedata";

export interface ScopeInfo {
  key: string;
  label: string;
  tip_count: number; // all pool tips (incl. extinct)
  extant_count: number; // excluding extinct — the "living only" denominator
  version: number;
  mode: "blob" | "hybrid" | "remote";
  notable_count?: number; // hybrid: tips shipped locally (the rest are the remote tail)
}

/** Fetch the available scopes. Returns [] if the backend is down (caller falls back to
 *  the default blob asset). */
export async function fetchScopes(): Promise<ScopeInfo[]> {
  try {
    const res = await fetch(`${API}/scopes/`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.scopes ?? []) as ScopeInfo[];
  } catch {
    return [];
  }
}

export interface CladeInfo {
  sci: string;
  common: string | null;
  tip_count: number;
}

// One in-flight/result cache per scope: the picker hovers the same packs repeatedly, so a
// hovered-then-unhovered-then-rehovered pack shouldn't refetch.
const cladeCache = new Map<string, Promise<CladeInfo[]>>();

/** The major clades inside one pack (#119) — for the picker's hover tooltip. Cached per
 *  scope; returns [] if unavailable. */
export function fetchClades(scope: string): Promise<CladeInfo[]> {
  const hit = cladeCache.get(scope);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await fetch(`${API}/clades/?scope=${encodeURIComponent(scope)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.clades ?? []) as CladeInfo[];
    } catch {
      return [];
    }
  })();
  cladeCache.set(scope, p);
  return p;
}
