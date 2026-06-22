// Marathon — the primary game. The tree canvas is the whole UI; a floating HUD holds
// the timer, the single name input, score, and the live count. A typed name resolves
// (exact alias lookup), routes onto the induced tree, and — when it places a NEW node —
// adds time + score. Full design: docs/marathon-design.md.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Wordmark } from "../components/Brand";
import { EndGameButton } from "../components/EndGameButton";
import { GameOverCard } from "../components/GameOverCard";
import { LoadingTree } from "../components/LoadingTree";
import { ScopePicker } from "../components/ScopePicker";
import { SettingsPanel } from "../components/SettingsPanel";
import { TreeRenderer } from "../components/TreeRenderer";
import { createEmptyAsset } from "../lib/asset/growable";
import { loadAsset, loadAssets } from "../lib/asset/load";
import { fetchScopes, type ScopeInfo } from "../lib/asset/scopes";
import type { InternedAsset, Target } from "../lib/asset/types";
import { fetchDaily, type DailyInfo } from "../lib/daily";
import { RemainingTracker } from "../lib/game/remaining";
import { clearRun, loadRun, saveRun, secondsAfterAway } from "../lib/game/persist";
import type { Difficulty } from "../lib/scores";
import { resolveTarget } from "../lib/game/resolveTarget";
import {
  DEFAULT_SETTINGS,
  isRankedSettings,
  loadSettings,
  saveSettings,
  type GameSettings,
} from "../lib/game/settings";
import { useTitle } from "../lib/useTitle";
import { createInducedTree, place, type InducedTree, type Placement } from "../lib/tree/induced";

interface Flash {
  text: string;
  tone: "good" | "small" | "none";
}

const SCOPE_KEY = "cladewright.scope";

export function Marathon() {
  // The daily reuses this exact game — only the "metadata" differs: a server-decided scope
  // (locked), default/ranked settings, mode marathon_daily, and a one-shot lock.
  const isDaily = new URLSearchParams(window.location.search).get("daily") === "1";
  useTitle(isDaily ? "Daily" : "Time attack");

  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  const [scopeKey, setScopeKey] = useState<string | null>(null);
  const [asset, setAsset] = useState<InternedAsset | null>(null);
  // undefined = still fetching, null = backend down, object = loaded (daily only).
  const [daily, setDaily] = useState<DailyInfo | null | undefined>(isDaily ? undefined : null);

  // Daily: today's puzzle dictates the (locked) scope.
  useEffect(() => {
    if (!isDaily) return;
    fetchDaily().then((d) => {
      setDaily(d);
      if (d?.available && d.scope) setScopeKey(d.scope);
    });
  }, [isDaily]);

  // Discover available scopes; for FREE play pick an initial one (URL ?scope=, last used,
  // or first). The daily sets its own scope above.
  useEffect(() => {
    fetchScopes().then((list) => {
      setScopes(list);
      if (isDaily) return;
      // A selection is one OR several scope keys (comma-joined) — the Hub's scope toggles
      // pass ?scopes=mammalia,aves; keep only keys this backend actually serves.
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("scopes") ?? params.get("scope");
      const remembered = localStorage.getItem(SCOPE_KEY);
      const sanitize = (joined: string | null): string => {
        const valid = new Set(list.map((s) => s.key));
        return (joined ?? "")
          .split(",")
          .map((k) => k.trim())
          .filter((k) => valid.has(k))
          .join(",");
      };
      const initial = [fromUrl, remembered].map(sanitize).find((v) => v) || list[0]?.key || null;
      setScopeKey(initial);
    });
  }, [isDaily]);

  // (Re)load the asset whenever the chosen scope changes. Remote scopes start empty and
  // grow via /resolve; blob scopes download whole. `?remote=<scope>` forces remote mode
  // for dev testing even if the catalog says blob.
  useEffect(() => {
    // Guard against out-of-order async loads: if the scope changes again before a
    // loadAsset() resolves, the stale result must not clobber the newer one.
    let cancelled = false;
    const apply = (a: InternedAsset) => {
      if (!cancelled) setAsset(a);
    };

    const forcedRemote = new URLSearchParams(window.location.search).get("remote");
    if (forcedRemote) {
      apply(createEmptyAsset(forcedRemote, 15));
      return;
    }
    if (scopeKey === null) {
      // No catalog (backend down) — fall back to the default blob asset.
      if (scopes.length === 0 && !isDaily) loadAsset().then(apply).catch(console.error);
      return () => {
        cancelled = true;
      };
    }
    if (!isDaily) localStorage.setItem(SCOPE_KEY, scopeKey); // don't clobber free-play memory
    const list = scopeKey.split(",").filter(Boolean);
    // Current version per scope, so the loader can hit the local cache (#43) and skip the
    // big download when our stored copy is still current.
    const versions = Object.fromEntries(scopes.map((s) => [s.key, s.version]));
    setAsset(null);
    if (list.length > 1) {
      // Scope mixing: fetch each blob and merge into one tree (remote scopes aren't mixable).
      loadAssets(list, versions).then(apply).catch(console.error);
    } else {
      const info = scopes.find((s) => s.key === list[0]);
      if (info?.mode === "remote") {
        apply(createEmptyAsset(list[0], 15));
      } else {
        loadAsset(list[0], info?.version).then(apply).catch(console.error);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [scopeKey, scopes, isDaily]);

  // Difficulty is chosen on the Hub and carried in the URL (?difficulty=). Fixed per game.
  const difficulty: Difficulty =
    new URLSearchParams(window.location.search).get("difficulty") === "scientific"
      ? "scientific"
      : "common";

  // Daily gates: loading, unavailable, or already played (one shot a day).
  if (isDaily) {
    if (daily === undefined) return <Loading />;
    if (!daily || !daily.available)
      return <DailyNotice title="No daily right now" body="Check back soon for today's puzzle." />;
    if (daily.played_today)
      return (
        <DailyNotice
          title="Today's daily is done"
          body={
            daily.today_score != null
              ? `You scored ${daily.today_score}. Come back tomorrow for a new one.`
              : "Come back tomorrow for a new one."
          }
          showBoard
        />
      );
  }

  if (!asset) return <Loading />;
  const mode = isDaily ? daily!.mode : "marathon_free";
  // Key by mode+scope+difficulty so switching any fully resets the game.
  return (
    <Game
      key={`${mode}:${asset.scope ?? scopeKey ?? "default"}:${difficulty}`}
      asset={asset}
      scopes={scopes}
      scopeKey={scopeKey}
      onScope={setScopeKey}
      difficulty={difficulty}
      mode={mode}
      isDaily={isDaily}
    />
  );
}

function Loading() {
  return <LoadingTree />;
}

/** Full-screen notice for the daily when it can't be played (none today, or already done). */
function DailyNotice({ title, body, showBoard }: { title: string; body: string; showBoard?: boolean }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-clade-bg px-6 text-center">
      <Wordmark size="text-3xl" />
      <h1 className="font-hand text-4xl font-bold text-clade-ink">{title}</h1>
      <p className="max-w-sm font-mono text-sm text-clade-ink/60">{body}</p>
      <div className="mt-2 flex items-center gap-3">
        <Link to="/" className="btn-play">
          ▶ Menu
        </Link>
        {showBoard && (
          <Link
            to="/leaderboard"
            className="rounded-full border-2 border-clade-ink/30 px-4 py-1.5 font-hand text-xl text-clade-ink/70 transition hover:border-clade-ink/60 hover:text-clade-ink"
          >
            Leaderboard
          </Link>
        )}
      </div>
    </div>
  );
}

function Game({
  asset,
  scopes,
  difficulty,
  scopeKey,
  onScope,
  mode,
  isDaily,
}: {
  asset: InternedAsset;
  scopes: ScopeInfo[];
  scopeKey: string | null;
  onScope: (key: string) => void;
  difficulty: Difficulty;
  mode: string;
  isDaily: boolean;
}) {
  // The induced tree + tracker are mutated in place (O(L)); `rev` triggers re-render.
  const treeRef = useRef<InducedTree>(createInducedTree());
  const tracker = useMemo(() => new RemainingTracker(asset), [asset]);
  const [rev, setRev] = useState(0);
  // Ordered ids of placements this run — submitted at game-over for server re-scoring.
  const transcriptRef = useRef<string[]>([]);

  // The daily is fixed/ranked: default settings, no tuning panel.
  const [settings, setSettings] = useState<GameSettings>(() =>
    isDaily ? { ...DEFAULT_SETTINGS } : loadSettings(),
  );
  // Ranked is a property of the WHOLE run, not just the settings at game-over: if a
  // score-affecting modifier was ever non-default (infinite time, boosted clock, an
  // extinct-inclusive pool), the run is permanently unranked — resetting to defaults at the
  // end must NOT relaunder it back onto the leaderboard. Seeded from the starting settings
  // (a run begun under custom settings is tainted from the first placement).
  const [rankTainted, setRankTainted] = useState(() => !isRankedSettings(settings));
  function updateSettings(next: GameSettings) {
    setSettings(next);
    saveSettings(next);
    if (!isRankedSettings(next)) setRankTainted(true); // one-way: never un-taints
    // Flipping infinite-time on revives a finished run so you can keep exploring.
    if (next.infiniteTime && !running) setRunning(true);
  }

  const [input, setInput] = useState("");
  const [score, setScore] = useState(0);
  const [count, setCount] = useState(0);
  const [seconds, setSeconds] = useState(settings.startSeconds);
  const [running, setRunning] = useState(true);
  // The clock doesn't tick until the first organism lands (#50) — no pressure while you
  // read the empty board / pick a scope. Flips true on the first placement and on restore.
  const [started, setStarted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  // A brief "ping" on the node a typed organism resolves to — confirms it landed (or
  // shows where the duplicate already lives). The nonce re-triggers the animation even
  // when the same node is named twice.
  const [pulse, setPulse] = useState<{ key: string; nonce: number } | null>(null);
  const pulseRef = useRef(0);

  // The "living only" toggle just re-points the "N remaining" denominator; reflect it on
  // the tracker and re-render the labels when it flips.
  useEffect(() => {
    tracker.extantOnly = settings.extantOnly;
    setRev((n) => n + 1);
  }, [settings.extantOnly, tracker]);

  useEffect(() => {
    if (!running || !started || settings.infiniteTime) return;
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
  }, [running, started, settings.infiniteTime]);

  // The persist key: this exact game (a restore only applies to a matching mode/scope/
  // difficulty/asset). asset.scope is set for blob/merged assets; fall back to scopeKey.
  const persistScope = asset.scope ?? scopeKey ?? "";

  // --- crash/refresh recovery (#33) ---
  // On mount, replay any saved transcript for THIS game so an accidental refresh (or the
  // browser's Backspace-navigates-back) doesn't wipe a run. Layout effect → rebuilt before
  // paint, so there's no flash of an empty tree. Runs once.
  const restoredRef = useRef(false);
  useLayoutEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = loadRun(mode, persistScope, difficulty, asset.raw.version);
    if (!saved) return;
    for (const id of saved.transcript) {
      const target = targetFromId(asset, id);
      if (!target) continue;
      const p = place(asset, treeRef.current, target);
      if (target.kind === "tip" && p.kind !== "duplicate") tracker.name(target.id);
    }
    transcriptRef.current = [...saved.transcript];
    const secs = secondsAfterAway(saved);
    setScore(saved.score);
    setCount(saved.count);
    setSeconds(settings.infiniteTime ? saved.seconds : secs);
    setRunning(settings.infiniteTime ? true : secs > 0);
    setStarted(true); // a restored run was already underway — keep the clock live
    if (saved.tainted) setRankTainted(true); // a restored run keeps its unranked status
    setRev((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist after every change while playing; clear the slot the instant the run ends so a
  // finished run can never be restored (and re-submitted). Saving each tick also refreshes
  // savedAt, keeping the away-time deduction accurate.
  useEffect(() => {
    if (!restoredRef.current) return; // don't overwrite a saved run before we've read it
    if (running) {
      saveRun({
        mode,
        scope: persistScope,
        difficulty,
        assetVersion: asset.raw.version,
        transcript: transcriptRef.current,
        score,
        count,
        seconds,
        infiniteTime: settings.infiniteTime,
        tainted: rankTainted,
        savedAt: Date.now(),
      });
    } else {
      clearRun();
    }
  }, [rev, score, count, seconds, running, settings.infiniteTime, rankTainted, mode, persistScope, difficulty, asset.raw.version]);

  // Keep typing flowing into the search no matter where focus is, and — crucially — stop
  // Backspace from triggering the browser's "back" navigation when the input isn't focused,
  // which would drop the player out of the game entirely (#33). Only while a run is live;
  // modifier combos (browser shortcuts) are left alone.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!running || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = inputRef.current;
      if (!el || document.activeElement === el) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
        return; // a real field (e.g. the scope search) has focus — don't steal it
      }
      if (e.key.length === 1 || e.key === "Backspace") {
        if (e.key === "Backspace") e.preventDefault(); // never let it navigate away
        el.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running]);

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
    // inside and just awaits an already-settled value. Scientific difficulty only accepts
    // the actual scientific name (no common-name aliases).
    const target = await resolveTarget(asset, query, difficulty === "scientific");
    if (!target) {
      setFlash({ text: `"${query}" — no match`, tone: "none" });
      return;
    }
    // Living-only mode: an extinct species isn't in play (and isn't in the denominator).
    if (settings.extantOnly && target.kind === "tip" && target.tip.traits.extinct) {
      setFlash({ text: `${target.tip.common} — extinct (living-only mode)`, tone: "none" });
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
      setStarted(true); // first organism landed → the clock starts now (#50)
      transcriptRef.current.push(target.id); // record for server re-scoring
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
    const pool = asset.raw.tips.filter(
      (t) => !placed.has(t.id) && (!settings.extantOnly || !t.traits.extinct),
    );
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
        transcriptRef.current.push(tip.id);
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

  // The scope this run submits to. A mix is a '+'-joined key ("aves+mammalia"); the server
  // re-scores it against each component scope's current build and ranks it on its own
  // combined board, so mixed runs are first-class (submitted + ranked) like single ones.
  const scopeId = asset.scope ?? scopeKey ?? "";
  // Run-level ranked: tainted-once-custom (not just the settings at game-over), so the live
  // badge and what's actually submitted can't disagree.
  const runRanked = !rankTainted;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-clade-bg">
      {/* decorative field-notebook frame around the canvas */}
      <div className="pointer-events-none absolute inset-2 z-0 rounded-[26px] border-2 border-clade-ink/15" />

      <div className="absolute left-4 top-4 z-30 flex items-center gap-3">
        <Wordmark size="text-2xl" />
        {isDaily ? (
          // Daily: scope is fixed (server-decided) — a badge, not a picker.
          <span className="rounded-full border-2 border-clade-accent/40 bg-clade-accent/[0.08] px-3 py-1 font-mono text-xs uppercase tracking-wider text-clade-accent">
            Daily · {scopes.find((s) => s.key === scopeKey)?.label ?? scopeKey}
          </span>
        ) : (
          <ScopePicker
            scopes={scopes}
            value={scopeKey ? scopeKey.split(",") : []}
            onChange={(keys) => onScope(keys.join(","))}
          />
        )}
      </div>
      {/* No tuning panel on the daily — it's fixed and ranked. */}
      {!isDaily && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onAutofill={autofill}
          runRanked={runRanked}
        />
      )}
      {/* End-the-run control sits just left of the settings gear; only while playing. */}
      {running && <EndGameButton onEnd={() => setRunning(false)} />}

      {/* HUD — timer (left) and tally (right) hug the corners, BELOW the wordmark/scope
          row so the picker never overlaps the timer. The search bar + notification are
          centered on the viewport independently, so the bar reads as dead-center. */}
      <div className="pointer-events-none absolute inset-x-0 top-32 z-10 flex items-start justify-between px-6 sm:top-20">
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

      {/* Search bar: dead-center on desktop (top-10). On mobile it spans the width and
          would collide with the wordmark/scope row above and the timer below, so it drops
          a row down (top-16) — the HUD timer/tally drops further (top-32) to match. */}
      <div className="pointer-events-none absolute left-1/2 top-16 z-20 flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4 sm:top-10">
        <form onSubmit={submit} className="pointer-events-auto w-full">
          <input
            ref={inputRef}
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
        scientificPrimary={difficulty === "scientific"}
        pulse={pulse}
        reveal={!running}
      />

      {!running && (
        // Game over: DON'T blanket the canvas — dock the card (right on desktop, top on
        // mobile) and leave the tree behind it pan/zoomable, so the player can wander what
        // they built. pointer-events-none on the frame lets drags fall through to the SVG;
        // the card itself re-enables them. (#24: explore-on-loss.)
        <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center p-3 sm:items-center sm:justify-end sm:p-6">
          <div className="pointer-events-auto">
          <GameOverCard
            mode={mode}
            count={count}
            score={score}
            scope={scopeId}
            scopeLabel={
              scopes.find((s) => s.key === scopeId)?.label ?? asset.raw.label ?? "this scope"
            }
            difficulty={difficulty}
            assetVersion={asset.raw.version}
            ranked={runRanked}
            allowReplay={!isDaily}
            transcript={transcriptRef.current}
            onPlayAgain={() => {
              treeRef.current = createInducedTree();
              tracker.reset();
              transcriptRef.current = [];
              setScore(0);
              setCount(0);
              setSeconds(settings.startSeconds);
              setStarted(false); // clock waits for the first word again (#50)
              setFlash(null);
              setPulse(null);
              setRev((n) => n + 1);
              // Fresh run: ranked again iff the current settings are default (a new run
              // started under custom settings stays tainted from the start).
              setRankTainted(!isRankedSettings(settings));
              setRunning(true);
            }}
          />
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

/** Reconstruct a placement Target from a stored transcript id (a tip or node id). Returns
 *  null if the id isn't in this asset (e.g. the asset was rebuilt) so replay can skip it. */
function targetFromId(asset: InternedAsset, id: string): Target | null {
  const tip = asset.tipById.get(id);
  if (tip) return { kind: "tip", id, tip };
  const node = asset.nodeById.get(id);
  if (node) return { kind: "node", id, node };
  return null;
}

/** Rank-depth of a node = how far below the root it sits (via parent chain). */
function lineageDepth(asset: InternedAsset, nodeIdx: number): number {
  let depth = 0;
  for (let cur = asset.parent[nodeIdx]; cur >= 0; cur = asset.parent[cur]) depth++;
  return depth;
}
