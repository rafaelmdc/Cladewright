// Wikipedia summary fetch for node cards. Uses the public REST summary endpoint, which
// returns an extract, a thumbnail, a short description, and the canonical article URL in
// one request — and follows redirects, so a scientific name resolves to its article.
// Results are cached (and in-flight requests deduped) so repeated hovers are free.

export interface WikiSummary {
  title: string;
  description?: string; // short gloss, e.g. "species of mammal"
  extract: string; // plain-text lead paragraph
  thumbnail?: string; // small (~200px) image URL, if any — fine for hover cards
  /** A card-sized render (~640px wide). NOT `originalimage`: that is the untouched upload and
   *  is routinely several MB, which is slow and pointless at card size. Wikimedia serves any
   *  width from the same path, so we rewrite the thumbnail's width prefix instead — one URL,
   *  already on their CDN, sharp on HiDPI without the download. */
  big?: string;
  url: string; // canonical desktop article URL
}

const API = "https://en.wikipedia.org/api/rest_v1/page/summary/";
// v2: added `big`. The bump matters — summaries are cached with no TTL, so on v1 every
// already-seen species would keep serving a record that has no big image, forever.
const LS_PREFIX = "cw.wiki.v2.";

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

/** Ask Wikimedia for a card-width render of the same file.
 *
 *  Their thumbnails live at `…/thumb/<a>/<ab>/<File>/<N>px-<File>`, and <N> is just a request
 *  for a size they generate on demand — so bumping it is free and stays on their CDN. Returns
 *  null for anything that isn't a /thumb/ URL (some summaries link the original directly), and
 *  never upscales past what we ask for. */
// Wikimedia no longer renders arbitrary thumbnail widths — an unlisted size now returns
// `400 Use thumbnail sizes listed on https://w.wiki/GHai`, which shows up as a broken image.
// Probing a real file gave 250 / 330 / 500 / 1280 as accepted, so ask for 500: comfortably
// sharper than the ~330 default at card size, without pulling a multi-megabyte original.
// Consumers must still handle failure (see SpecimenPlate's onError) — this list is Wikimedia's
// to change, and the summary's own thumbnail URL is always a safe fallback.
const CARD_WIDTH = 500;
function cardSized(thumb: string | undefined, originalWidth?: number): string | undefined {
  if (!thumb || !thumb.includes("/thumb/")) return undefined;
  // Never ask for more than the source has: upscales are rejected too.
  if (originalWidth && originalWidth < CARD_WIDTH) return undefined;
  return thumb.replace(/\/(\d+)px-([^/]+)$/, (m, have: string, file: string) =>
    Number(have) >= CARD_WIDTH ? m : `/${CARD_WIDTH}px-${file}`,
  );
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
    big: cardSized(j.thumbnail?.source, j.originalimage?.width) ?? j.thumbnail?.source,
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
