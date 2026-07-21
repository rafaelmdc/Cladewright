// The Clade Clash board — the ONE surface the game is played on.
//
// Facing health bars, a specimen between two candidates, the reveal figure, the countdown.
// This used to exist twice, once in each page, because solo and versus were built as two
// games; they are one game with two ways to play (docs/clade-clash-design.md), so every
// change had to be made twice and the two drifted — versus never got the reveal figure, and
// solo never got the opponent's display name.
//
// It renders a `MatchView` (lib/clash/match.ts) and knows nothing about where the match comes
// from: `useBotMatch` deals locally, `useClashMatch` takes it off a websocket. Anything that
// differs between them is a field on the view, not a branch in here.

import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";

import { HealthGauge } from "./HealthGauge";
import { RevealClado } from "./RevealClado";
import { RevealCountdown } from "./RevealCountdown";
import { SpecimenPlate } from "./SpecimenPlate";
import { HP_MAX } from "../../lib/game/cladeClash";
import { type CardTip, type MatchView, REVEAL_MS } from "../../lib/clash/match";

export function ClashBoard({ match, exit }: { match: MatchView; exit?: React.ReactNode }) {
  const { phase, you, opp, round, myPick, oppLocked, reveal, over, opponentLeft, lens } = match;

  if (phase === "over" && over) {
    return <MatchOver match={match} exit={exit} />;
  }
  if (!round || !you || !opp) {
    return (
      <p className="font-hand text-2xl text-clade-ink/60 animate-pulse">
        {match.connected ? "dealing a round…" : "waiting for your opponent…"}
      </p>
    );
  }

  const revealed = phase === "revealed";
  // The reveal figure is drawn from the answer-free round plus the reveal's ranks: the closer
  // candidate is `correct`, the further one is the other. Derived here so both drivers get it
  // — versus had no explainer at all before this.
  const near = reveal ? round.options[reveal.correct] : null;
  const far = reveal ? round.options[reveal.correct === 0 ? 1 : 0] : null;

  return (
    <div className="flex w-full max-w-3xl flex-col items-center">
      {/* HUD: facing health bars (GeoGuessr-style) with the round between them */}
      <div className="mb-4 flex w-full items-end gap-4">
        <HealthGauge
          label={you.display}
          hp={you.hp}
          max={HP_MAX}
          dmg={revealed && reveal?.iBled ? reveal.damage : 0}
          highlight
        />
        <div className="shrink-0 pb-1 text-center font-mono text-[11px] uppercase tracking-widest text-clade-ink/45">
          R{round.num}
          {!match.ranked && <div className="text-[9px] text-clade-ink/35">unranked</div>}
        </div>
        <HealthGauge
          label={opp.display}
          hp={opp.hp}
          max={HP_MAX}
          dmg={revealed && reveal?.oppBled ? reveal.damage : 0}
          reverse
        />
      </div>

      <Timer round={round} frozen={phase !== "playing"} />

      <div className="grid w-full grid-cols-1 items-start gap-4 sm:grid-cols-3">
        <OptionCard match={match} side={0} />
        <div className="flex flex-col items-center justify-center gap-2">
          <div className="ink-card w-full overflow-hidden bg-clade-paper p-0 shadow-sm ring-2 ring-clade-accent/25">
            <div className="border-b-2 border-clade-ink/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-clade-accent">
              Specimen
            </div>
            <SpecimenPlate {...round.center} lens={lens} compact spoil={revealed} />
          </div>
          <div className="font-hand text-lg italic text-clade-ink/40">closer to…?</div>
        </div>
        <OptionCard match={match} side={1} />
      </div>

      {/* The payoff: WHY one is closer, drawn rather than described. Reserves no space while
          playing, so the board doesn't shift when it appears. */}
      <AnimatePresence>
        {revealed && reveal && near && far && (
          <div className="mt-4 flex w-full justify-center">
            <RevealClado
              center={round.center}
              near={near}
              far={far}
              nearRank={reveal.mrcaRank[reveal.correct]}
              farRank={reveal.mrcaRank[reveal.correct === 0 ? 1 : 0]}
              youPickedNear={reveal.myPick === null ? null : reveal.myPick === reveal.correct}
              lens={lens}
            />
          </div>
        )}
      </AnimatePresence>

      <div className="mt-4 flex h-7 items-center font-mono text-xs uppercase tracking-widest text-clade-ink/40">
        {opponentLeft ? (
          "opponent left — play it out"
        ) : phase === "playing" ? (
          myPick === null ? (
            "pick the closer relative"
          ) : oppLocked ? (
            "revealing…"
          ) : (
            `locked in — waiting on ${opp.display.toLowerCase() === "bot" ? "the bot" : "your opponent"}`
          )
        ) : (
          <RevealCountdown ms={REVEAL_MS} onSkip={match.skipReveal} />
        )}
      </div>
    </div>
  );
}

/** The per-round clock, driven by the round's DEADLINE rather than a local countdown, so a
 *  server-dealt round and a locally-dealt one animate identically. */
function Timer({ round, frozen }: { round: { deadline: number; seconds: number; num: number }; frozen: boolean }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (frozen) return;
    setNow(Date.now() / 1000);
    const id = window.setInterval(() => setNow(Date.now() / 1000), 200);
    return () => window.clearInterval(id);
  }, [frozen, round.num]);
  const left = Math.max(0, round.deadline - now);
  const frac = frozen ? 1 : Math.max(0, Math.min(1, left / round.seconds));
  return (
    <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-clade-ink/10">
      <div
        className={`h-full rounded-full transition-[width] duration-200 ease-linear ${
          left <= 3 && !frozen ? "bg-red-500" : "bg-clade-accent"
        }`}
        style={{ width: `${frac * 100}%` }}
      />
    </div>
  );
}

function OptionCard({ match, side }: { match: MatchView; side: 0 | 1 }) {
  const { phase, round, myPick, reveal, lens } = match;
  const tip = round!.options[side] as CardTip;
  const revealed = phase === "revealed";
  const isCorrect = reveal?.correct === side;
  const picked = myPick === side;
  const live = phase === "playing" && myPick === null;

  // Reveal desaturates the losing plate rather than just fading it: at a glance the correct
  // animal is the one still in full colour.
  const tone = !revealed
    ? picked
      ? "border-clade-accent ring-2 ring-clade-accent/40"
      : "border-clade-ink/15 hover:border-clade-accent/70"
    : isCorrect
      ? "border-clade-accent ring-2 ring-clade-accent"
      : "border-clade-ink/15 opacity-60 grayscale";

  return (
    <motion.button
      type="button"
      /* NOT `disabled`: a disabled button emits no pointer events in Chrome, which would kill
         the hover zoom on every spent card — including during the reveal, when you most want
         to look at the animal. The driver's `lock` guards the pick instead. */
      aria-disabled={!live}
      onClick={() => match.lock(side)}
      /* It should look pickable before you commit, and spent once you have. */
      whileHover={live ? { y: -2 } : undefined}
      whileTap={live ? { y: 0, scale: 0.99 } : undefined}
      className={`ink-card relative flex flex-col overflow-hidden bg-clade-paper p-0 text-left transition ${tone} ${
        live ? "cursor-pointer" : "cursor-default"
      }`}
    >
      <SpecimenPlate {...tip} lens={lens} spoil={revealed} />

      {/* lock-in: an ink underline sweeps the plate, so a spent pick reads as committed */}
      {picked && !revealed && (
        <>
          <motion.div
            layout
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute inset-x-0 bottom-0 h-1 origin-left bg-clade-accent"
          />
          <span className="absolute right-2 top-2 rounded-full bg-clade-accent px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-clade-paper">
            you
          </span>
        </>
      )}

      {/* reveal: verdict + who picked it */}
      <AnimatePresence>
        {revealed && reveal && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-1 border-t-2 border-clade-ink/10 px-3 py-2"
          >
            <span
              className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                isCorrect
                  ? "bg-clade-accent text-clade-paper"
                  : "border border-clade-ink/25 text-clade-ink/55"
              }`}
            >
              {isCorrect ? "closer" : "further"}
              {reveal.mrcaRank[side] ? ` · shares ${reveal.mrcaRank[side]}` : ""}
            </span>
            <div className="flex gap-1">
              {reveal.myPick === side && <Tag label="you" good={isCorrect} />}
              {reveal.oppPick === side && (
                <Tag label={match.opp?.display ?? "them"} good={isCorrect} muted />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
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

function MatchOver({ match, exit }: { match: MatchView; exit?: React.ReactNode }) {
  const { you, opp, over, round } = match;
  const label = over!.deadHeat ? "Dead heat" : over!.youWon ? "You win" : "You lose";
  return (
    <div className="ink-card w-[26rem] max-w-full bg-clade-paper px-8 py-8 text-center">
      <div className="font-mono text-[11px] uppercase tracking-widest text-clade-ink/45">
        Match over{round ? ` · ${round.num} round${round.num === 1 ? "" : "s"}` : ""}
      </div>
      <h1
        className={`mt-1 font-hand text-5xl font-bold ${
          over!.youWon ? "text-clade-accent" : "text-clade-ink"
        }`}
      >
        {label}
      </h1>
      <div className="mt-6 flex flex-col gap-3">
        {you && <HealthGauge label={you.display} hp={you.hp} max={HP_MAX} highlight={over!.youWon} />}
        {opp && (
          <HealthGauge
            label={opp.display}
            hp={opp.hp}
            max={HP_MAX}
            highlight={!over!.youWon && !over!.deadHeat}
            reverse
          />
        )}
      </div>
      {/* Two actions side by side need room to stay on one line each — a "Play\nagain" button
          reads as broken. */}
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3 [&_*]:whitespace-nowrap">
        {match.playAgain && (
          <button onClick={match.playAgain} className="btn-play">
            ▶ Play again
          </button>
        )}
        {exit}
      </div>
      <Link
        to="/"
        className="mt-4 inline-block font-mono text-xs uppercase tracking-widest text-clade-ink/50 hover:text-clade-ink"
      >
        Menu
      </Link>
    </div>
  );
}
