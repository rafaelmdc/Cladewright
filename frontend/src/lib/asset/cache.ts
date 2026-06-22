// HTML5 local cache for whole game-asset blobs (#43). The assets are multi-MB JSON and the
// API re-serves them on every load (no Cache-Control / ETag), so a returning visitor pays
// the full download each time. We stash the raw asset in IndexedDB (localStorage caps at
// ~5MB and is synchronous — too small and too blocking for these) keyed by scope, with the
// version it was built at.
//
// The flow the loader uses: the app already fetches the cheap scopes metadata (which
// carries each scope's current version) before the asset, so that's the "verify if we have
// a copy" check — if our cached version matches, we skip the big GET entirely; on a miss we
// download and re-cache. One row per scope (writing replaces it), so only the latest
// version is kept and storage stays bounded. Everything here is best-effort: any failure
// (private mode, quota, no IndexedDB) silently falls back to the network.

import type { GameAsset } from "./types";

const DB_NAME = "cladewright";
const STORE = "assets";
const DB_VERSION = 1;

interface Row {
  scope: string; // keyPath
  version: number;
  asset: GameAsset;
}

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "scope" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/** The cached raw asset for this scope IFF it was built at `version`; null on any miss. */
export async function readCachedAsset(scope: string, version: number): Promise<GameAsset | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(scope);
      req.onsuccess = () => {
        const row = req.result as Row | undefined;
        resolve(row && row.version === version ? row.asset : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    } finally {
      db.close();
    }
  });
}

/** Store (or replace) this scope's raw asset + version. Best-effort. */
export async function writeCachedAsset(scope: string, version: number, asset: GameAsset): Promise<void> {
  const db = await openDB();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).put({ scope, version, asset } satisfies Row);
  } catch {
    /* quota / serialization — skip caching, the app still works off the network */
  } finally {
    db.close();
  }
}
