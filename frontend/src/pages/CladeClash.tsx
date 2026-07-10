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
import { makeRound, roundScore, type ClashRound } from "../lib/game/cladeClash";
import type { Relatedness } from "../lib/game/distance";
import { useTitle } from "../lib/useTitle";

const ROUNDS = 10; // a match is a short sprint of rounds
const ROUND_SECONDS = 12; // per-round clock; runs out → auto-reveal, no pick scored
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
  const [round, setRound] = useState<ClashRound | null>(() => makeRound(asset));
  const [roundNum, setRoundNum] = useState(1);
  const [phase, setPhase] = useState<Phase>("playing");
  const [pick, setPick] = useState<Side | null>(null);
  const [botPick, setBotPick] = useState<Side | null>(null);
  const [botLocked, setBotLocked] = useState(false);
  const [seconds, setSeconds] = useState(ROUND_SECONDS);
  const [you, setYou] = useState({ score: 0, correct: 0 });
  const [bot, setBot] = useState({ score: 0, correct: 0 });

  const pickRef = useRef<Side | null>(null);
  const botPickRef = useRef<Side | null>(null);
  const secondsRef = useRef(ROUND_SECONDS); // clock source of truth (reveal reads the live value)
  const botTimer = useRef<number | undefined>(undefined);
  const tick = useRef<number | undefined>(undefined);

  // If the pool can't form a fair round at all, bail gracefully.
  const flat = round === null;

  const nextRound = useCallback(() => {
    if (roundNum >= ROUNDS) {
      setPhase("over");
      return;
    }
    setRoundNum((n) => n + 1);
    setRound(makeRound(asset));
    setPick(null);
    setBotPick(null);
    setBotLocked(false);
    pickRef.current = null;
    botPickRef.current = null;
    setSeconds(ROUND_SECONDS);
    setPhase("playing");
  }, [asset, roundNum]);

  const reveal = useCallback(() => {
    setPhase((p) => {
      if (p !== "playing" || !round) return p;
      const frac = secondsRef.current / ROUND_SECONDS; // live remaining time → speed bonus
      // Score YOU: only a locked-in, correct, in-time pick pays.
      if (pickRef.current === round.correct) {
        setYou((v) => ({ score: v.score + roundScore(round.gap, frac), correct: v.correct + 1 }));
      }
      // Score the BOT from where it actually locked (botPickRef); it's fast + usually right.
      if (botPickRef.current === round.correct) {
        setBot((v) => ({ score: v.score + roundScore(round.gap, 0.7), correct: v.correct + 1 }));
      }
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
    setYou({ score: 0, correct: 0 });
    setBot({ score: 0, correct: 0 });
    setRoundNum(1);
    setRound(makeRound(asset));
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
    const win = you.score > bot.score ? "You win" : you.score < bot.score ? "Bot wins" : "Dead heat";
    return (
      <Shell>
        <div className="ink-card bg-clade-paper px-8 py-8 text-center">
          <div className="font-mono text-[11px] uppercase tracking-widest text-clade-ink/45">Match over</div>
          <h1 className="mt-1 font-hand text-5xl font-bold text-clade-accent">{win}</h1>
          <div className="mt-5 flex items-stretch justify-center gap-4">
            <Tally label="You" score={you.score} correct={you.correct} highlight={you.score >= bot.score} />
            <div className="self-center font-hand text-2xl text-clade-ink/40">vs</div>
            <Tally label="Bot" score={bot.score} correct={bot.correct} highlight={bot.score > you.score} />
          </div>
          <div className="mt-6 flex items-center justify-center gap-3">
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
      {/* HUD: round + running score */}
      <div className="mb-4 flex w-full max-w-3xl items-center justify-between">
        <div className="font-mono text-xs uppercase tracking-widest text-clade-ink/50">
          Round {roundNum}/{ROUNDS}
        </div>
        <div className="flex items-center gap-4 font-mono text-xs uppercase tracking-widest">
          <span className="text-clade-accent">You {you.score}</span>
          <span className="text-clade-ink/45">Bot {botLocked || phase === "revealed" ? bot.score : "…"}</span>
        </div>
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

function Tally({ label, score, correct, highlight }: { label: string; score: number; correct: number; highlight: boolean }) {
  return (
    <div className={`rounded-2xl border-2 px-6 py-4 ${highlight ? "border-clade-accent bg-clade-accent/5" : "border-clade-ink/15"}`}>
      <div className="font-mono text-[10px] uppercase tracking-widest text-clade-ink/45">{label}</div>
      <div className="font-hand text-4xl font-bold text-clade-ink">{score}</div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-clade-ink/45">{correct}/{ROUNDS} right</div>
    </div>
  );
}
