// Clade Clash — the distance-guessing mode (#36). A centre species sits between two
// candidates; pick the closer relative before the clock runs out. Solo play is you vs a bot.
//
// Phase 0: SOLO + BOT, UNRANKED. The answer is derivable from the loaded tree, so ranked
// integrity (server grading + reaction-time plausibility) waits for Phase 1 realtime — here
// nothing is submitted, so a modified client only fools itself. Same packs + lobby as Time
// Attack. See docs/clade-clash-design.md.

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Wordmark } from "../components/Brand";
import { LeafBackground } from "../components/LeafBackground";
import { LoadingTree } from "../components/LoadingTree";
import { loadAsset, loadHybridAsset, loadMixed, loadRemoteAsset } from "../lib/asset/load";
import { fetchScopes, type ScopeInfo } from "../lib/asset/scopes";
import type { AssetTip, InternedAsset } from "../lib/asset/types";
import { decodeConfig } from "../lib/game/config";
import { DEFAULT_ENGINE, HP_MAX, makeRound, type ClashRound } from "../lib/game/cladeClash";
import type { Relatedness } from "../lib/game/distance";
import { useTitle } from "../lib/useTitle";

// The active distance engine — what "closer relative" means, and how much a miss hurts. Swap
// it (or thread it from the lobby config / scope later) to change the metric without touching
// the game loop. See lib/game/cladeClash.ts.
const ENGINE = DEFAULT_ENGINE;

const ROUND_CAP = 20; // safety ceiling: if nobody's health hits 0 by here, the higher HP wins
const ROUND_SECONDS = 12; // per-round clock; runs out → auto-reveal, an unlocked pick counts as a miss
const REVEAL_MS = 2200; // how long the reveal lingers before the next round

export function CladeClash() {
  useTitle("Clade Clash");
  const [cfg] = useState(() => {
    const code = new URLSearchParams(window.location.search).get("c");
    return code ? decodeConfig(code) : null;
  });
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  const [asset, setAsset] = useState<InternedAsset | null>(null);

  // Resolve the scope from the lobby config (like Marathon); a bare /clash with no config
  // falls back to the default asset so the mode is always playable/testable.
  useEffect(() => {
    let cancelled = false;
    fetchScopes().then((list) => {
      if (cancelled) return;
      setScopes(list);
      const valid = new Set(list.map((s) => s.key));
      const chosen = (cfg?.scopes ?? []).filter((k) => valid.has(k));
      const apply = (a: InternedAsset) => !cancelled && setAsset(a);
      if (chosen.length > 1) {
        loadMixed(chosen, list).then(apply).catch(console.error);
      } else if (chosen.length === 1) {
        const info = list.find((s) => s.key === chosen[0]);
        if (info?.mode === "remote") loadRemoteAsset(chosen[0], 15, info.version).then(apply).catch(console.error);
        else if (info?.mode === "hybrid") loadHybridAsset(chosen[0], info.version).then(apply).catch(console.error);
        else loadAsset(chosen[0], info?.version).then(apply).catch(console.error);
      } else {
        loadAsset().then(apply).catch(console.error); // no/invalid config → default pool
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cfg]);

  if (!asset) return <LoadingTree />;
  return <ClashGame asset={asset} scopes={scopes} scopeKey={(cfg?.scopes ?? []).join(",")} />;
}

type Phase = "playing" | "revealed" | "over";
type Side = 0 | 1;

function ClashGame({ asset }: { asset: InternedAsset; scopes: ScopeInfo[]; scopeKey: string }) {
  const [round, setRound] = useState<ClashRound | null>(() => makeRound(asset, ENGINE));
  const [roundNum, setRoundNum] = useState(1);
  const [phase, setPhase] = useState<Phase>("playing");
  const [pick, setPick] = useState<Side | null>(null);
  const [botPick, setBotPick] = useState<Side | null>(null);
  const [botLocked, setBotLocked] = useState(false);
  const [seconds, setSeconds] = useState(ROUND_SECONDS);
  const [youHp, setYouHp] = useState(HP_MAX);
  const [botHp, setBotHp] = useState(HP_MAX);
  const [dmg, setDmg] = useState<{ you: number; bot: number }>({ you: 0, bot: 0 }); // this round's hits (for the reveal)

  const pickRef = useRef<Side | null>(null);
  const botPickRef = useRef<Side | null>(null);
  const youHpRef = useRef(HP_MAX); // HP source of truth (reveal reads/writes these, not stale state)
  const botHpRef = useRef(HP_MAX);
  const overRef = useRef(false); // a killing blow this round → end after the reveal lingers
  const secondsRef = useRef(ROUND_SECONDS); // clock source of truth (reveal reads the live value)
  const botTimer = useRef<number | undefined>(undefined);
  const tick = useRef<number | undefined>(undefined);

  // If the pool can't form a fair round at all, bail gracefully.
  const flat = round === null;

  const nextRound = useCallback(() => {
    if (overRef.current || roundNum >= ROUND_CAP) {
      setPhase("over");
      return;
    }
    setRoundNum((n) => n + 1);
    setRound(makeRound(asset, ENGINE));
    setPick(null);
    setBotPick(null);
    setBotLocked(false);
    pickRef.current = null;
    botPickRef.current = null;
    setDmg({ you: 0, bot: 0 });
    setSeconds(ROUND_SECONDS);
    setPhase("playing");
  }, [asset, roundNum]);

  const reveal = useCallback(() => {
    setPhase((p) => {
      if (p !== "playing" || !round) return p;
      // Difference model (GeoGuessr-style): only a differing outcome deals damage; matching
      // picks — both right OR both wrong — are a wash. A null pick (timeout) counts as a miss.
      const youMiss = pickRef.current !== round.correct;
      const botMiss = botPickRef.current !== round.correct;
      let dy = 0;
      let db = 0;
      if (youMiss && !botMiss) dy = ENGINE.damage(round.gap);
      else if (botMiss && !youMiss) db = ENGINE.damage(round.gap);
      youHpRef.current = Math.max(0, youHpRef.current - dy);
      botHpRef.current = Math.max(0, botHpRef.current - db);
      setYouHp(youHpRef.current);
      setBotHp(botHpRef.current);
      setDmg({ you: dy, bot: db });
      if (youHpRef.current <= 0 || botHpRef.current <= 0) overRef.current = true; // killing blow
      window.clearTimeout(botTimer.current);
      window.clearInterval(tick.current);
      window.setTimeout(nextRound, REVEAL_MS);
      return "revealed";
    });
  }, [round, nextRound]);

  // Per-round clock + bot scheduling. Restarts whenever a fresh round starts.
  useEffect(() => {
    if (phase !== "playing" || !round) return;
    secondsRef.current = ROUND_SECONDS;
    setSeconds(ROUND_SECONDS);
    // The bot: "extremely efficient" — fast reaction, high accuracy (a touch lower on hard,
    // small-gap rounds). It picks the server-truth answer (derivable here) after a delay.
    const accuracy = round.gap >= 3 ? 0.97 : 0.86;
    const correct = Math.random() < accuracy;
    const choice: Side = (correct ? round.correct : (round.correct ^ 1)) as Side;
    const delay = 700 + Math.random() * 1600 + (round.gap < 2 ? 600 : 0);
    botTimer.current = window.setTimeout(() => {
      botPickRef.current = choice;
      setBotPick(choice);
      setBotLocked(true);
      if (pickRef.current !== null) reveal(); // both locked → reveal now
    }, delay);

    // The interval body (not a setState updater) mutates secondsRef, so it's safe under
    // StrictMode's double-invoke and reveal() always reads the true remaining time.
    tick.current = window.setInterval(() => {
      secondsRef.current -= 1;
      setSeconds(secondsRef.current);
      if (secondsRef.current <= 0) {
        window.clearInterval(tick.current);
        reveal(); // time up → reveal regardless of locks
      }
    }, 1000);

    return () => {
      window.clearTimeout(botTimer.current);
      window.clearInterval(tick.current);
    };
  }, [round, phase, reveal]);

  function choose(side: Side) {
    if (phase !== "playing" || pick !== null) return;
    setPick(side);
    pickRef.current = side;
    if (botPickRef.current !== null) reveal(); // opponent already in → reveal
  }

  function playAgain() {
    youHpRef.current = HP_MAX;
    botHpRef.current = HP_MAX;
    overRef.current = false;
    setYouHp(HP_MAX);
    setBotHp(HP_MAX);
    setDmg({ you: 0, bot: 0 });
    setRoundNum(1);
    setRound(makeRound(asset, ENGINE));
    setPick(null);
    setBotPick(null);
    setBotLocked(false);
    pickRef.current = null;
    botPickRef.current = null;
    setSeconds(ROUND_SECONDS);
    setPhase("playing");
  }

  if (flat) {
    return (
      <Shell>
        <div className="ink-card bg-clade-paper px-8 py-10 text-center">
          <p className="font-hand text-2xl text-clade-ink">This pack is too small for a duel.</p>
          <p className="mt-1 font-mono text-xs text-clade-ink/55">Pick a bigger pack (or a mix) and try again.</p>
          <Link to="/play/clash_solo" className="btn-play mt-4 inline-block">▶ Back to setup</Link>
        </div>
      </Shell>
    );
  }

  if (phase === "over") {
    const win = youHp <= 0 && botHp > 0 ? "Bot wins" : botHp <= 0 && youHp > 0 ? "You win"
      : youHp > botHp ? "You win" : youHp < botHp ? "Bot wins" : "Dead heat";
    const youWon = win === "You win";
    return (
      <Shell>
        <div className="ink-card w-[22rem] max-w-full bg-clade-paper px-8 py-8 text-center">
          <div className="font-mono text-[11px] uppercase tracking-widest text-clade-ink/45">
            Match over · {roundNum} round{roundNum === 1 ? "" : "s"}
          </div>
          <h1 className={`mt-1 font-hand text-5xl font-bold ${youWon ? "text-clade-accent" : "text-clade-ink"}`}>{win}</h1>
          <div className="mt-6 flex flex-col gap-3">
            <HpBar label="You" hp={youHp} highlight={youWon} />
            <HpBar label="Bot" hp={botHp} highlight={win === "Bot wins"} />
          </div>
          <div className="mt-7 flex items-center justify-center gap-3">
            <button onClick={playAgain} className="btn-play">▶ Play again</button>
            <Link to="/" className="font-mono text-xs uppercase tracking-widest text-clade-ink/50 hover:text-clade-ink">
              Menu
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  const frac = seconds / ROUND_SECONDS;
  return (
    <Shell>
      {/* HUD: facing health bars (GeoGuessr-style) with the round between them */}
      <div className="mb-4 flex w-full max-w-3xl items-end gap-4">
        <HpBar label="You" hp={youHp} dmg={phase === "revealed" ? dmg.you : 0} highlight />
        <div className="shrink-0 pb-1 font-mono text-[11px] uppercase tracking-widest text-clade-ink/45">
          R{roundNum}
        </div>
        <HpBar label="Bot" hp={botHp} dmg={phase === "revealed" ? dmg.bot : 0} reverse />
      </div>

      {/* timer bar */}
      <div className="mb-5 h-1.5 w-full max-w-3xl overflow-hidden rounded-full bg-clade-ink/10">
        <div
          className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${seconds <= 3 ? "bg-red-500" : "bg-clade-accent"}`}
          style={{ width: `${phase === "playing" ? frac * 100 : 100}%` }}
        />
      </div>

      <div className="grid w-full max-w-3xl grid-cols-1 items-stretch gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <OptionCard
          tip={round!.options[0]}
          rel={round!.rel[0]}
          side={0}
          picked={pick === 0}
          isCorrect={round!.correct === 0}
          botPicked={botPick === 0}
          phase={phase}
          onPick={() => choose(0)}
        />
        <div className="flex flex-col items-center justify-center gap-2">
          <CenterCard tip={round!.center} />
          <div className="font-hand text-lg italic text-clade-ink/40">closer to…?</div>
        </div>
        <OptionCard
          tip={round!.options[1]}
          rel={round!.rel[1]}
          side={1}
          picked={pick === 1}
          isCorrect={round!.correct === 1}
          botPicked={botPick === 1}
          phase={phase}
          onPick={() => choose(1)}
        />
      </div>

      <div className="mt-4 h-5 font-mono text-xs uppercase tracking-widest text-clade-ink/40">
        {phase === "playing"
          ? pick === null
            ? "pick the closer relative"
            : botLocked
              ? "revealing…"
              : "locked in — waiting on the bot"
          : ""}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen w-screen flex-col items-center justify-center overflow-hidden bg-clade-bg px-4 py-8">
      <LeafBackground density={16} interactive={false} className="pointer-events-none absolute inset-0 -z-10" />
      <div className="absolute left-4 top-4">
        <Link to="/">
          <Wordmark size="text-xl" />
        </Link>
      </div>
      {children}
    </div>
  );
}

function CenterCard({ tip }: { tip: AssetTip }) {
  return (
    <div className="ink-card w-52 max-w-full bg-clade-paper px-4 py-4 text-center shadow-sm">
      <div className="font-mono text-[10px] uppercase tracking-widest text-clade-accent">Specimen</div>
      <div className="mt-1 font-hand text-2xl font-bold leading-tight text-clade-ink">{tip.common}</div>
      <div className="font-hand text-sm italic text-clade-ink/55">{tip.sci}</div>
    </div>
  );
}

function OptionCard({
  tip,
  rel,
  picked,
  isCorrect,
  botPicked,
  phase,
  onPick,
}: {
  tip: AssetTip;
  rel: Relatedness;
  side: Side;
  picked: boolean;
  isCorrect: boolean;
  botPicked: boolean;
  phase: Phase;
  onPick: () => void;
}) {
  const revealed = phase === "revealed";
  const tone = !revealed
    ? picked
      ? "border-clade-accent ring-2 ring-clade-accent/40"
      : "border-clade-ink/15 hover:border-clade-ink/40"
    : isCorrect
      ? "border-clade-accent ring-2 ring-clade-accent"
      : "border-red-400/60 opacity-70";
  return (
    <button
      type="button"
      disabled={phase !== "playing" || picked}
      onClick={onPick}
      className={`ink-card relative flex min-h-[9rem] flex-col items-center justify-center gap-1 bg-clade-paper px-4 py-5 text-center transition ${tone} ${phase === "playing" && !picked ? "cursor-pointer" : "cursor-default"}`}
    >
      <div className="font-hand text-2xl font-bold leading-tight text-clade-ink">{tip.common}</div>
      <div className="font-hand text-sm italic text-clade-ink/55">{tip.sci}</div>

      {/* your lock-in marker */}
      {picked && !revealed && (
        <span className="absolute right-2 top-2 rounded-full bg-clade-accent px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-clade-paper">
          you
        </span>
      )}

      {/* reveal: verdict + who picked it */}
      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 flex flex-col items-center gap-1"
          >
            <span
              className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${isCorrect ? "bg-clade-accent text-clade-paper" : "border border-red-400/60 text-red-600"}`}
            >
              {isCorrect ? "closer" : "further"}
              {rel.mrcaRank ? ` · shares ${rel.mrcaRank}` : ""}
            </span>
            <div className="flex gap-1">
              {picked && <Tag label="you" good={isCorrect} />}
              {botPicked && <Tag label="bot" good={isCorrect} muted />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}

function Tag({ label, good, muted }: { label: string; good: boolean; muted?: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
        good ? "text-clade-accent" : "text-red-500"
      } ${muted ? "opacity-70" : ""}`}
    >
      {label} {good ? "✓" : "✗"}
    </span>
  );
}

function HpBar({
  label,
  hp,
  dmg = 0,
  reverse,
  highlight,
}: {
  label: string;
  hp: number;
  dmg?: number;
  reverse?: boolean;
  highlight?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, (hp / HP_MAX) * 100));
  const color = hp <= 25 ? "bg-red-500" : hp <= 55 ? "bg-amber-500" : "bg-clade-accent";
  return (
    <div className="flex-1">
      <div className={`flex items-baseline justify-between font-mono text-[10px] uppercase tracking-widest ${reverse ? "flex-row-reverse" : ""}`}>
        <span className={highlight ? "text-clade-accent" : "text-clade-ink/50"}>{label}</span>
        <span className="tabular-nums text-clade-ink/60">
          {dmg > 0 && <span className="mr-1 text-red-500">−{dmg}</span>}
          {Math.max(0, Math.round(hp))}
        </span>
      </div>
      <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-clade-ink/10">
        <div
          className={`absolute inset-y-0 ${reverse ? "right-0" : "left-0"} rounded-full ${color} transition-[width] duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
