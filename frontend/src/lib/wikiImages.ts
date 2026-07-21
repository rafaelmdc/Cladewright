// "Does this species have a picture?" — in bulk, cheaply (#146).
//
// Clade Clash is a game of looking at an animal, so a round whose cards are empty hatched
// panels is not a round. We assumed fame carried the art ("famous species are the ones with
// photographs" — docs/clade-clash-design.md), but fame is a proxy and a leaky one: plenty of
// mid-fame fish have a common name, a Wikipedia article and no photo at all. Nothing was ever
// actually FILTERED, which is what #146 reports.
//
// The durable fix bakes `has_image` into the asset (backend/pipeline/enrich.py), but every
// pack in production predates that, so the round generator also needs an answer at runtime —
// and one it can get for a whole batch of candidates before committing to a round.
//
// The REST summary endpoint used by lib/wiki.ts is one request per title, far too slow to
// screen candidates. The action API takes FIFTY titles per request and resolves redirects, so
// a scientific name ("Panthera leo") lands on the article a player would see ("Lion"). One
// request screens ~16 candidate rounds. Answers are permanent (a species does not lose its
// photograph), so they persist to localStorage and the network cost decays to zero.

const API = "https://en.wikipedia.org/w/api.php";
const CHUNK = 50; // the action API's titles-per-request cap for anonymous clients
const LS_KEY = "cw.wikiimg.v1";
const LS_CAP = 20000; // keep the persisted index bounded; the hot pool is far smaller

/** title -> has a page image. Loaded once from localStorage, written back debounced. */
let index: Map<string, boolean> | null = null;
const inflight = new Map<string, Promise<void>>();

function load(): Map<string, boolean> {
  if (index) return index;
  index = new Map();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, number>)) {
        index.set(k, v === 1);
      }
    }
  } catch {
    /* corrupt or unavailable storage — the in-memory index still works */
  }
  return index;
}

let saveTimer: number | undefined;
function save(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const map = load();
    try {
      const out: Record<string, number> = {};
      let n = 0;
      for (const [k, v] of map) {
        if (n++ >= LS_CAP) break;
        out[k] = v ? 1 : 0;
      }
      localStorage.setItem(LS_KEY, JSON.stringify(out));
    } catch {
      /* storage full — keep serving from memory */
    }
  }, 1000);
}

/** What we already know about a title: true/false, or undefined if it's never been asked. */
export function knownHasImage(title: string): boolean | undefined {
  return load().get(title);
}

async function fetchChunk(titles: string[]): Promise<void> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*", // anonymous CORS
    prop: "pageimages",
    piprop: "thumbnail",
    pithumbsize: "500",
    redirects: "1", // "Panthera leo" -> "Lion"
    titles: titles.join("|"),
  });
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`wikipedia images ${res.status}`);
  const data = await res.json();
  const q = data?.query ?? {};

  // A requested title reaches its page through up to two hops (normalization, then redirect).
  // Follow the chain so the answer lands on the title we were ASKED about, not the target.
  const hop = new Map<string, string>();
  for (const list of [q.normalized, q.redirects]) {
    for (const { from, to } of (list ?? []) as { from: string; to: string }[]) hop.set(from, to);
  }
  const resolve = (t: string): string => {
    let cur = t;
    for (let i = 0; i < 4 && hop.has(cur); i++) cur = hop.get(cur)!;
    return cur;
  };

  const withImage = new Set<string>();
  for (const page of (q.pages ?? []) as { title: string; thumbnail?: unknown }[]) {
    if (page.thumbnail) withImage.add(page.title);
  }
  const map = load();
  // Every REQUESTED title gets an answer, including the ones whose article doesn't exist —
  // a missing page is a definite "no picture", and caching that is the whole point.
  for (const t of titles) map.set(t, withImage.has(resolve(t)));
  save();
}

/** Resolve every unknown title in `titles`, in batches. Already-known titles cost nothing.
 *  Never rejects: a network failure leaves those titles unknown, and callers treat unknown as
 *  "allow" so a Wikipedia outage degrades the filter rather than the game. */
export async function ensureImages(titles: string[]): Promise<void> {
  const map = load();
  const todo = [...new Set(titles.filter((t) => t && !map.has(t) && !inflight.has(t)))];
  if (todo.length === 0) {
    // Still wait on anything another caller is already asking about, so a caller that awaits
    // ensureImages() can rely on the answers being in the index when it resolves.
    await Promise.all(titles.map((t) => inflight.get(t)).filter(Boolean));
    return;
  }

  const jobs: Promise<void>[] = [];
  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    const job = fetchChunk(chunk).catch(() => {
      /* leave them unknown — callers allow unknowns */
    });
    for (const t of chunk) inflight.set(t, job);
    jobs.push(job.finally(() => chunk.forEach((t) => inflight.delete(t))));
  }
  await Promise.all(jobs);
}
