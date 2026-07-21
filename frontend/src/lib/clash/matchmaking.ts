// Clade Clash versus matchmaking REST client (#36 Phase 1). Thin wrappers over
// /api/clash/* — quick-match queue + private rooms. Play itself happens over the websocket
// the returned Pairing's token authorizes (see socket.ts). All calls are authenticated
// (session cookie) + CSRF-guarded on POST/DELETE.

import { csrfToken } from "../auth";
import { DEFAULT_ENGINE_ID } from "../game/cladeClash";

export interface Pairing {
  match_id: string;
  seat: number;
  token: string;
  opponent: string;
  scope: string;
  engine_id: string;
}

/** A pairing, or {status:"waiting"} while still queued/hosting. */
export type MatchmakeResult = Pairing | { status: "waiting" };

export function isPairing(r: MatchmakeResult | null): r is Pairing {
  return !!r && "match_id" in r;
}

const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
    body: body ? JSON.stringify(body) : undefined,
  });

/** Join the quick-match queue for a pack (or a MIX of packs — #147); resolves to a Pairing if
 *  matched now, else waiting. The server canonicalises the key, so two players who picked the
 *  same packs in a different order still queue together. */
export async function quickMatch(
  scope: string | string[],
  engineId = DEFAULT_ENGINE_ID,
): Promise<MatchmakeResult> {
  const res = await post("/api/clash/queue/", { scope, engine_id: engineId });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "matchmaking failed");
  return res.json();
}

/** Poll for a pairing while waiting in the queue / hosting a room. */
export async function pollPairing(): Promise<MatchmakeResult> {
  const res = await fetch("/api/clash/queue/", { credentials: "include" });
  return res.json();
}

/** A mix as one key, matching the server's canonical form (sorted, '+'-joined — see
 *  apps/clash/pools.py). Only needed where the scope rides in the URL rather than a body. */
function scopeParam(scope: string | string[]): string {
  return (Array.isArray(scope) ? [...scope].sort().join("+") : scope);
}

/** Leave the quick-match queue. */
export async function leaveQueue(scope: string | string[], engineId = DEFAULT_ENGINE_ID): Promise<void> {
  await fetch(`/api/clash/queue/?scope=${encodeURIComponent(scopeParam(scope))}&engine_id=${engineId}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "X-CSRFToken": csrfToken() },
  });
}

/** Create a private room; returns the code to share. Host then polls pollPairing(). */
export async function createRoom(scope: string | string[], engineId = DEFAULT_ENGINE_ID): Promise<string> {
  const res = await post("/api/clash/rooms/", { scope, engine_id: engineId });
  if (!res.ok) throw new Error("could not create room");
  return (await res.json()).code as string;
}

/** Join a private room by code; returns the Pairing. */
export async function joinRoom(code: string): Promise<Pairing> {
  const res = await post(`/api/clash/rooms/${encodeURIComponent(code.toUpperCase())}/join/`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "room not found");
  return res.json();
}
