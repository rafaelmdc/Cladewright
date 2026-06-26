// The FAQ page (/faq): clickable cards that expand to reveal the answer. Content is curated in
// the Django admin (apps/content), so this page is data — no code change to add a question.

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { TopBar } from "../components/Brand";
import { LeafBackground } from "../components/LeafBackground";
import { fetchFaq, type FaqEntry } from "../lib/faq";
import { useTitle } from "../lib/useTitle";

export function Faq() {
  useTitle("FAQ");
  const [entries, setEntries] = useState<FaqEntry[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    fetchFaq().then(setEntries);
  }, []);

  return (
    <div className="min-h-screen">
      <LeafBackground density={20} />
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-8">
        <TopBar />

        <div className="flex flex-1 flex-col gap-6 py-6">
          <div>
            <Link
              to="/"
              className="font-mono text-[11px] uppercase tracking-widest text-clade-ink/40 transition hover:text-clade-ink"
            >
              ← Home
            </Link>
            <h1 className="mt-1 font-hand text-5xl font-bold text-clade-ink">Questions</h1>
            <p className="font-hand text-xl text-clade-ink/70">Tap a card to see the answer.</p>
          </div>

          {entries === null ? (
            <p className="font-mono text-xs text-clade-ink/40">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="font-mono text-sm text-clade-ink/45">Nothing here yet — check back soon.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {entries.map((e) => (
                <FaqCard
                  key={e.id}
                  entry={e}
                  open={open === e.id}
                  onToggle={() => setOpen((cur) => (cur === e.id ? null : e.id))}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FaqCard({
  entry,
  open,
  onToggle,
}: {
  entry: FaqEntry;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="ink-card overflow-hidden bg-clade-paper">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-clade-accentSoft/30"
      >
        <span className="font-hand text-2xl font-bold text-clade-ink">{entry.question}</span>
        <Chevron open={open} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-clade-ink/10 px-5 py-4">
              {entry.answer.split(/\n{2,}/).map((para, i) => (
                <p key={i} className="mb-2 font-hand text-xl leading-snug text-clade-ink/75 last:mb-0">
                  {para}
                </p>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <motion.svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-clade-ink/40"
      animate={{ rotate: open ? 180 : 0 }}
      transition={{ duration: 0.15 }}
    >
      <path d="M6 9l6 6 6-6" />
    </motion.svg>
  );
}
