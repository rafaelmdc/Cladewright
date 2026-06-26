// GameConfig — the single source of truth for "what game are we about to play": the mode,
// the lens (difficulty), the chosen pack(s), the tuning settings, and (future) the active
// gameplay modifiers. The lobby builds one; starting threads it to the play surface. It is
// also exactly what a multiplayer host will broadcast to a room — single-player is a room of
// one. See docs/lobby-and-config.md.

import type { Difficulty } from "../scores";
import { gameDefaults, type GameSettings } from "./settings";

export interface GameConfig {
  mode: string; // the game, e.g. "marathon_free"
  difficulty: Difficulty; // the lens — common | scientific
  scopes: string[]; // the chosen packs (sorted; a mix is first-class)
  settings: GameSettings; // per-game tuning + visual dials
  modifiers: string[]; // active gameplay mutators — empty until the modifier feature (#101)
}

// Bump when the encoded shape changes incompatibly; decode rejects other versions so an old
// link never silently mis-decodes into a wrong setup.
const VERSION = 1;

/** A fresh config for a game, from the current (admin-overlaid) defaults. */
export function defaultConfig(
  mode: string,
  opts?: { difficulty?: Difficulty; scopes?: string[] },
): GameConfig {
  return {
    mode,
    difficulty: opts?.difficulty ?? "common",
    scopes: opts?.scopes ? [...opts.scopes].sort() : [],
    settings: { ...gameDefaults() },
    modifiers: [],
  };
}

/** Only the settings that differ from the current defaults — keeps the encoded payload tiny
 *  (a default/ranked setup carries no settings at all). */
function settingsDelta(s: GameSettings): Partial<GameSettings> {
  const def = gameDefaults();
  const out: Partial<GameSettings> = {};
  for (const k of Object.keys(s) as (keyof GameSettings)[]) {
    if (s[k] !== def[k]) (out as Record<string, unknown>)[k] = s[k];
  }
  return out;
}

// URL-safe base64 of the (ASCII-only: mode/scope keys, numbers, enum strings) JSON payload.
function b64urlEncode(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(code: string): unknown {
  return JSON.parse(atob(code.replace(/-/g, "+").replace(/_/g, "/")));
}

/** Compact, URL-safe, versioned code for a config — the seed format for shareable setups,
 *  "beat my run" challenges, and (later) lobby invites. Settings ride as a delta-from-default
 *  so a typical setup is a handful of chars. We don't ship share UI yet; the FORMAT is fixed
 *  now so those features build on a stable seed. */
export function encodeConfig(cfg: GameConfig): string {
  const payload: Record<string, unknown> = {
    v: VERSION,
    m: cfg.mode,
    d: cfg.difficulty,
    s: cfg.scopes,
    st: settingsDelta(cfg.settings),
  };
  if (cfg.modifiers.length) payload.x = cfg.modifiers;
  return b64urlEncode(payload);
}

/** Decode a config code back to a GameConfig, merging its settings delta over the current
 *  defaults. Null on any malformed / wrong-version input (callers fall back to defaultConfig). */
export function decodeConfig(code: string): GameConfig | null {
  try {
    const p = b64urlDecode(code) as Record<string, unknown>;
    if (!p || p.v !== VERSION || typeof p.m !== "string") return null;
    const delta = p.st && typeof p.st === "object" ? (p.st as Partial<GameSettings>) : {};
    return {
      mode: p.m,
      difficulty: p.d === "scientific" ? "scientific" : "common",
      scopes: Array.isArray(p.s) ? (p.s as unknown[]).filter((x): x is string => typeof x === "string") : [],
      settings: { ...gameDefaults(), ...delta },
      modifiers: Array.isArray(p.x) ? (p.x as unknown[]).filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    return null;
  }
}
