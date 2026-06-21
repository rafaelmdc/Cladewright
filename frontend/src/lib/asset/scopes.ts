// The scope catalog — what the picker renders. One entry per current build the backend
// serves, with its delivery mode (blob = download whole; remote = play incrementally).

const API = import.meta.env.VITE_API_BASE ?? "/api/gamedata";

export interface ScopeInfo {
  key: string;
  label: string;
  tip_count: number; // all pool tips (incl. extinct)
  extant_count: number; // excluding extinct — the "living only" denominator
  version: number;
  mode: "blob" | "remote";
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
