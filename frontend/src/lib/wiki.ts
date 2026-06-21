// Wikipedia summary fetch for node cards. Uses the public REST summary endpoint, which
// returns an extract, a thumbnail, a short description, and the canonical article URL in
// one request — and follows redirects, so a scientific name resolves to its article.
// Results are cached (and in-flight requests deduped) so repeated hovers are free.

export interface WikiSummary {
  title: string;
  description?: string; // short gloss, e.g. "species of mammal"
  extract: string; // plain-text lead paragraph
  thumbnail?: string; // image URL, if any
  url: string; // canonical desktop article URL
}

const API = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const LS_PREFIX = "cw.wiki.v1.";

// Two cache layers: an in-memory Map (hot, dedupes within a session) backed by
// localStorage (survives reloads, so we never re-hit Wikipedia for a name we've already
// resolved). Taxon summaries are effectively static, so there's no TTL.
const cache = new Map<string, WikiSummary | null>();
const inflight = new Map<string, Promise<WikiSummary | null>>();

function readStore(key: string): WikiSummary | null | undefined {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw == null) return undefined; // never fetched
    return JSON.parse(raw) as WikiSummary | null;
  } catch {
    return undefined;
  }
}

function writeStore(key: string, value: WikiSummary | null): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable — the in-memory cache still works */
  }
}

async function fetchOne(title: string): Promise<WikiSummary | null> {
  const res = await fetch(API + encodeURIComponent(title.replace(/ /g, "_")), {
    headers: { accept: "application/json" },
  });
  if (!res.ok) return null;
  const j = await res.json();
  // Skip disambiguation / empty pages — they aren't a useful card.
  if (j.type === "disambiguation" || !j.extract) return null;
  return {
    title: j.title ?? title,
    description: j.description,
    extract: j.extract,
    thumbnail: j.thumbnail?.source,
    url:
      j.content_urls?.desktop?.page ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
  };
}

/** Resolve the first candidate title that has a real article (tries common name, then
 *  scientific name). Cached by the candidate list. */
export function fetchWikiSummary(candidates: string[]): Promise<WikiSummary | null> {
  const list = candidates.filter(Boolean);
  const key = list.join("|");

  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  const stored = readStore(key);
  if (stored !== undefined) {
    cache.set(key, stored); // promote persisted result into the hot cache
    return Promise.resolve(stored);
  }
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    for (const c of list) {
      try {
        const r = await fetchOne(c);
        if (r) {
          cache.set(key, r);
          writeStore(key, r);
          return r;
        }
      } catch {
        /* network hiccup — try the next candidate */
      }
    }
    cache.set(key, null);
    writeStore(key, null);
    return null;
  })();

  inflight.set(key, p);
  void p.finally(() => inflight.delete(key));
  return p;
}
