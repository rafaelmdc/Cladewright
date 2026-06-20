// Marathon — the primary game. The tree canvas is the whole UI; a floating HUD holds
// the timer, the single name input, score, and the live count. A typed name resolves
// (exact alias lookup), routes onto the induced tree, and — when it places a NEW node —
// adds time + score. Full design: docs/marathon-design.md.

import { useEffect, useMemo, useRef, useState } from "react";

import { TreeRenderer } from "../components/TreeRenderer";
import { loadAsset } from "../lib/asset/load";
import type { InternedAsset } from "../lib/asset/types";
import { RemainingTracker } from "../lib/game/remaining";
import { resolve } from "../lib/game/resolve";
import { createInducedTree, place, type InducedTree, type Placement } from "../lib/tree/induced";

const START_SECONDS = 60;

interface Flash {
  text: string;
  tone: "good" | "small" | "none";
}

export function Marathon() {
  const [asset, setAsset] = useState<InternedAsset | null>(null);
  useEffect(() => {
    loadAsset().then(setAsset).catch(console.error);
  }, []);

  if (!asset) return <p className="p-6 text-clade-ink/60">Loading the tree…</p>;
  return <Game asset={asset} />;
}

function Game({ asset }: { asset: InternedAsset }) {
  // The induced tree + tracker are mutated in place (O(L)); `rev` triggers re-render.
  const treeRef = useRef<InducedTree>(createInducedTree());
  const tracker = useMemo(() => new RemainingTracker(asset), [asset]);
  const [rev, setRev] = useState(0);

  const [input, setInput] = useState("");
  const [score, setScore] = useState(0);
  const [count, setCount] = useState(0);
  const [seconds, setSeconds] = useState(START_SECONDS);
  const [running, setRunning] = useState(true);
  const [flash, setFlash] = useState<Flash | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          setRunning(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  function rewardFor(p: Placement): { time: number; points: number } {
    if (p.kind === "duplicate") return { time: 0, points: 0 };
    if (p.kind === "refinement") return { time: 2, points: 1 }; // small dopamine
    // Novelty: a shallow MRCA (little overlap with the existing tree) opens more
    // backbone → bigger bonus. mrcaIdx === -1 is the very first placement (most novel).
    const depth = p.mrcaIdx < 0 ? 0 : lineageDepth(asset, p.mrcaIdx);
    const novelty = Math.max(0, 6 - depth); // root-ish placements worth more
    return { time: 4 + novelty, points: 10 };
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = input.trim();
    setInput("");
    if (!running || !query) return;

    const target = resolve(asset, query);
    if (!target) {
      setFlash({ text: `"${query}" — no match`, tone: "none" });
      return;
    }
    const p = place(asset, treeRef.current, target);
    if (target.kind === "tip" && p.kind !== "duplicate") tracker.name(target.id);

    const label = target.kind === "tip" ? target.tip.common : target.node.sci;
    if (p.kind === "duplicate") {
      setFlash({ text: `${label} — already on the tree`, tone: "none" });
    } else {
      const { time, points } = rewardFor(p);
      setScore((v) => v + points);
      setCount((v) => v + 1);
      setSeconds((s) => Math.min(START_SECONDS * 3, s + time));
      setFlash({
        text: `${label} +${time}s${p.kind === "refinement" ? " (refined)" : ""}`,
        tone: p.kind === "refinement" ? "small" : "good",
      });
    }
    setRev((n) => n + 1);
  }

  const flashColor =
    flash?.tone === "good"
      ? "text-clade-accent"
      : flash?.tone === "small"
        ? "text-clade-ink/70"
        : "text-clade-ink/40";

  return (
    <div className="relative h-screen w-screen bg-clade-bg">
      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2 p-4">
        <div className="flex items-center gap-6 font-mono text-sm text-clade-ink/70">
          <span className={seconds <= 10 ? "text-red-500" : ""}>⏱ {seconds}s</span>
          <span>{score} pts</span>
          <span>{count} on the tree</span>
        </div>
        <form onSubmit={submit} className="pointer-events-auto w-full max-w-md">
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!running}
            placeholder={running ? "name an organism — it lands on the tree…" : "time!"}
            className="w-full rounded-xl border border-clade-ink/15 bg-white/80 px-4 py-2.5 text-center shadow-sm outline-none backdrop-blur placeholder:text-clade-ink/35 focus:border-clade-accent"
          />
        </form>
        <span className={`h-5 text-sm ${flashColor}`}>{flash?.text ?? ""}</span>
      </div>

      <TreeRenderer asset={asset} tree={treeRef.current} tracker={tracker} rev={rev} />

      {!running && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-clade-bg/70 backdrop-blur">
          <h2 className="text-3xl font-semibold">Time!</h2>
          <p className="mt-2 text-clade-ink/70">
            {count} placed · {score} points
          </p>
          <button
            onClick={() => {
              treeRef.current = createInducedTree();
              tracker.reset();
              setScore(0);
              setCount(0);
              setSeconds(START_SECONDS);
              setFlash(null);
              setRev((n) => n + 1);
              setRunning(true);
            }}
            className="mt-6 rounded-lg bg-clade-accent px-4 py-2 text-white"
          >
            Play again
          </button>
        </div>
      )}
    </div>
  );
}

/** Rank-depth of a node = how far below the root it sits (via parent chain). */
function lineageDepth(asset: InternedAsset, nodeIdx: number): number {
  let depth = 0;
  for (let cur = asset.parent[nodeIdx]; cur >= 0; cur = asset.parent[cur]) depth++;
  return depth;
}
