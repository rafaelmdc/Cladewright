// Marathon — the primary game. The tree canvas is the whole UI; a floating HUD holds
// the timer, the single name input, score, and the live count. A typed name resolves
// (exact alias lookup), routes onto the induced tree, and — when it places a NEW node —
// adds time + score. Full design: docs/marathon-design.md.

import { useEffect, useMemo, useRef, useState } from "react";

import { Wordmark } from "../components/Brand";
import { SettingsPanel } from "../components/SettingsPanel";
import { TreeRenderer } from "../components/TreeRenderer";
import { createEmptyAsset } from "../lib/asset/growable";
import { loadAsset } from "../lib/asset/load";
import type { InternedAsset, Target } from "../lib/asset/types";
import { RemainingTracker } from "../lib/game/remaining";
import { resolveTarget } from "../lib/game/resolveTarget";
import { loadSettings, saveSettings, type GameSettings } from "../lib/game/settings";
import { createInducedTree, place, type InducedTree, type Placement } from "../lib/tree/induced";

interface Flash {
  text: string;
  tone: "good" | "small" | "none";
}

export function Marathon() {
  const [asset, setAsset] = useState<InternedAsset | null>(null);
  useEffect(() => {
    // TEMP entry hook (until the scope picker, task #5): `?remote=<scope>` starts a huge-
    // scope game served incrementally — empty asset grown via /resolve. Otherwise the
    // normal blob asset is downloaded whole.
    const remoteScope = new URLSearchParams(window.location.search).get("remote");
    if (remoteScope) {
      setAsset(createEmptyAsset(remoteScope, 15));
    } else {
      loadAsset().then(setAsset).catch(console.error);
    }
  }, []);

  if (!asset) return <p className="p-6 text-clade-ink/60">Loading the tree…</p>;
  return <Game asset={asset} />;
}

function Game({ asset }: { asset: InternedAsset }) {
  // The induced tree + tracker are mutated in place (O(L)); `rev` triggers re-render.
  const treeRef = useRef<InducedTree>(createInducedTree());
  const tracker = useMemo(() => new RemainingTracker(asset), [asset]);
  const [rev, setRev] = useState(0);

  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  function updateSettings(next: GameSettings) {
    setSettings(next);
    saveSettings(next);
    // Flipping infinite-time on revives a finished run so you can keep exploring.
    if (next.infiniteTime && !running) setRunning(true);
  }

  const [input, setInput] = useState("");
  const [score, setScore] = useState(0);
  const [count, setCount] = useState(0);
  const [seconds, setSeconds] = useState(settings.startSeconds);
  const [running, setRunning] = useState(true);
  const [flash, setFlash] = useState<Flash | null>(null);
  // A brief "ping" on the node a typed organism resolves to — confirms it landed (or
  // shows where the duplicate already lives). The nonce re-triggers the animation even
  // when the same node is named twice.
  const [pulse, setPulse] = useState<{ key: string; nonce: number } | null>(null);
  const pulseRef = useRef(0);

  useEffect(() => {
    if (!running || settings.infiniteTime) return;
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
  }, [running, settings.infiniteTime]);

  function rewardFor(p: Placement): { time: number; points: number } {
    if (p.kind === "duplicate") return { time: 0, points: 0 };
    if (p.kind === "refinement") return { time: settings.timePerRefinement, points: 1 };
    // Novelty: a shallow MRCA (little overlap with the existing tree) opens more
    // backbone → bigger bonus. depth 0 (root-ish) earns the full novelty bonus,
    // tapering to 0 by depth 6.
    const depth = p.mrcaIdx < 0 ? 0 : lineageDepth(asset, p.mrcaIdx);
    const novelty = Math.round(settings.noveltyBonus * Math.max(0, 1 - depth / 6));
    return { time: settings.timePerNew + novelty, points: 10 };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = input.trim();
    setInput("");
    if (!running || !query) return;

    // Async to cover remote mode (/search + /resolve); blob mode resolves synchronously
    // inside and just awaits an already-settled value.
    const target = await resolveTarget(asset, query);
    if (!target) {
      setFlash({ text: `"${query}" — no match`, tone: "none" });
      return;
    }
    const p = place(asset, treeRef.current, target);
    if (target.kind === "tip" && p.kind !== "duplicate") tracker.name(target.id);
    // It resolved to a real organism — flash where it sits on the tree.
    setPulse({ key: target.id, nonce: ++pulseRef.current });

    const label = target.kind === "tip" ? target.tip.common : target.node.sci;
    if (p.kind === "duplicate") {
      setFlash({ text: `${label} — already on the tree`, tone: "none" });
    } else {
      const { time, points } = rewardFor(p);
      setScore((v) => v + points);
      setCount((v) => v + 1);
      setSeconds((s) => Math.min(9999, s + time));
      setFlash({
        text: `${label} +${time}s${p.kind === "refinement" ? " (refined)" : ""}`,
        tone: p.kind === "refinement" ? "small" : "good",
      });
    }
    setRev((n) => n + 1);
  }

  // DEV CHEAT (remove before launch): drop N random, not-yet-placed species onto the
  // tree at once so we don't have to hand-type one to test layout/rendering at scale.
  function autofill(n: number) {
    const placed = treeRef.current.namedTips;
    const pool = asset.raw.tips.filter((t) => !placed.has(t.id));
    // partial Fisher–Yates: shuffle just the first `take` slots, then take them.
    const take = Math.min(n, pool.length);
    for (let i = 0; i < take; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let added = 0;
    for (let i = 0; i < take; i++) {
      const tip = pool[i];
      const target: Target = { kind: "tip", id: tip.id, tip };
      const p = place(asset, treeRef.current, target);
      if (p.kind !== "duplicate") {
        tracker.name(tip.id);
        added += 1;
      }
    }
    if (added > 0) {
      setCount((v) => v + added);
      setFlash({ text: `cheat: +${added} placed`, tone: "small" });
      setRev((v) => v + 1);
    }
  }

  const flashColor =
    flash?.tone === "good"
      ? "text-clade-accent"
      : flash?.tone === "small"
        ? "text-clade-ink/70"
        : "text-clade-ink/40";

  const lowTime = !settings.infiniteTime && seconds <= 10;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-clade-bg">
      {/* decorative field-notebook frame around the canvas */}
      <div className="pointer-events-none absolute inset-2 z-0 rounded-[26px] border-2 border-clade-ink/15" />

      <div className="absolute left-4 top-4 z-30">
        <Wordmark size="text-2xl" />
      </div>
      <SettingsPanel settings={settings} onChange={updateSettings} onAutofill={autofill} />

      {/* HUD — timer (left) and tally (right) hug the corners; the search bar and its
          notification are centered on the viewport independently, so the bar reads as
          dead-center regardless of how wide the side stats grow. */}
      <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex items-start justify-between px-6">
        <div className="leading-none">
          <span className="font-mono text-[10px] uppercase tracking-widest text-clade-ink/45">
            Time
          </span>
          <div className={`font-hand text-4xl font-bold ${lowTime ? "text-red-600" : "text-clade-ink"}`}>
            {settings.infiniteTime ? "∞" : fmtTime(seconds)}
          </div>
        </div>
        <div className="text-right leading-none">
          <div className="font-hand text-4xl font-bold text-clade-ink">{count}</div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-clade-ink/45">
            on the tree · {score} pts
          </span>
        </div>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-10 z-20 flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
        <form onSubmit={submit} className="pointer-events-auto w-full">
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!running}
            placeholder={running ? "name an organism — it lands on the tree…" : "time!"}
            className="w-full rounded-2xl border-2 border-clade-ink/80 bg-clade-paper/90 px-4 py-2.5 text-center font-hand text-2xl text-clade-ink shadow-sm outline-none backdrop-blur placeholder:text-clade-ink/35 focus:border-clade-accent"
          />
        </form>
        {flash && (
          <span
            className={`rounded-full border border-clade-ink/10 bg-clade-paper/95 px-4 py-1 font-hand text-xl shadow-sm ${flashColor}`}
          >
            {flash.text}
          </span>
        )}
      </div>

      <TreeRenderer
        asset={asset}
        tree={treeRef.current}
        tracker={tracker}
        rev={rev}
        layout={settings.treeLayout}
        showScientific={settings.showScientific}
        pulse={pulse}
      />

      {!running && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-clade-bg/60 backdrop-blur-sm">
          <div className="ink-card flex flex-col items-center bg-clade-paper px-10 py-8 text-center">
            <h2 className="font-hand text-6xl font-bold text-clade-ink">Time!</h2>
            <p className="mt-2 font-mono text-sm text-clade-ink/60">
              {count} placed · {score} points
            </p>
            <button
              onClick={() => {
                treeRef.current = createInducedTree();
                tracker.reset();
                setScore(0);
                setCount(0);
                setSeconds(settings.startSeconds);
                setFlash(null);
                setPulse(null);
                setRev((n) => n + 1);
                setRunning(true);
              }}
              className="btn-play mt-6"
            >
              ▶ Play again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Seconds → m:ss (matches the mock's "1:48"). */
function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Rank-depth of a node = how far below the root it sits (via parent chain). */
function lineageDepth(asset: InternedAsset, nodeIdx: number): number {
  let depth = 0;
  for (let cur = asset.parent[nodeIdx]; cur >= 0; cur = asset.parent[cur]) depth++;
  return depth;
}
