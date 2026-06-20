// Classic — Metazooa-style daily (Phase 5). Rides on the same asset + TreeRenderer +
// autocomplete as Marathon. One mystery animal/day (server-authoritative seed); each
// guess places the MRCA of guess + answer and warms a proximity bar; limited guesses.
// See docs/examples/metazooa_copy.png. Phase 0: placeholder.

export function Classic() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Classic</h1>
      <p className="mt-3 text-clade-ink/70">
        Daily mystery-animal mode — built in Phase 5 on the shared tree and data layer.
      </p>
    </main>
  );
}
