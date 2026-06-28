// Pack "sets" (#120) — admin-curated bundles of packs the lobby offers as one-click presets.
// A set just selects its member scopes into the existing multi-pack mix; the backend filters
// out any scope it no longer serves, so a set degrades gracefully.

const API = import.meta.env.VITE_API_BASE ?? "/api/gamedata";

export interface SetInfo {
  key: string;
  label: string;
  blurb: string;
  scopes: string[];
  pack_count: number;
  tip_count: number;
}

/** Fetch the available pack sets. Returns [] if the backend is down or none are configured. */
export async function fetchSets(): Promise<SetInfo[]> {
  try {
    const res = await fetch(`${API}/sets/`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.sets ?? []) as SetInfo[];
  } catch {
    return [];
  }
}
