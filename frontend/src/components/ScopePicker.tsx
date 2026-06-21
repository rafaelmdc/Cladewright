// The scope selector — pick which slice of the tree of life to play (Mammals, Birds,
// Fish, …). Renders the backend's scope catalog; choosing one reloads the game for that
// scope. A "remote" scope (too big to download) is tagged so the player knows it streams.

import type { ScopeInfo } from "../lib/asset/scopes";

export function ScopePicker({
  scopes,
  value,
  onChange,
}: {
  scopes: ScopeInfo[];
  value: string | null;
  onChange: (key: string) => void;
}) {
  if (scopes.length === 0) return null;
  return (
    <label className="pointer-events-auto flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-widest text-clade-ink/45">
        Scope
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border-2 border-clade-ink/30 bg-clade-paper/90 px-2.5 py-1 font-hand text-lg text-clade-ink outline-none focus:border-clade-accent"
      >
        {scopes.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label} ({s.tip_count.toLocaleString()})
            {s.mode === "remote" ? " · streamed" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
