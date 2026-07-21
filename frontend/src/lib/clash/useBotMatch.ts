// The solo/bot driver: deals and grades Clade Clash locally, with the bot as the opponent.
//
// Phase 0's deal — CLIENT-SIDE and UNRANKED. Nothing is submitted, so a modified client only
// fools itself, and the mode stays playable with no account and no round-trip. Its counterpart
// is useClashMatch, which hands the same job to the server for ranked human duels; both
// present a MatchView so one board renders either (see match.ts).
//
// The rules live here only once each: HP, the difference-damage model and the round cap are
// the referee's rules mirrored (apps/clash/referee.py), which is the same mirror the round
// generator already maintains.
//
// **All mutable game state lives in refs, not state.** The round is driven by timers (the bot's
// pick, the deadline, the reveal's linger), and a timer scheduled during one render must not
// grade the round against that render's snapshot. State here is for RENDERING only.

import { useCallback, useEffect, useRef, useState } from "react";

import type { InternedAsset } from "../asset/types";
import {
  BOT_DELAY_JITTER_MS,
  BOT_DELAY_MIN_MS,
  type ClashRound,
  DEFAULT_ENGINE,
  type DistanceEngine,
  HP_MAX,
  makeShowableRound,
} from "../game/cladeClash";
import type { NameLens } from "../game/settings";
import { type MatchView, type Phase, REVEAL_MS, type RevealView, type RoundView } from "./match";

const ROUND_CAP = 20; // if nobody's health hits 0 by here, the higher HP wins (mirrors referee.py)
const ROUND_SECONDS = 12; // per-round clock; running out reveals, and an unlocked pick is a miss

export function useBotMatch(
  asset: InternedAsset | null,
  opts: { engine?: DistanceEngine; fameBias?: number; lens?: NameLens } = {},
): MatchView {
  const { engine = DEFAULT_ENGINE, fameBias = 0, lens = "both" } = opts;

  const [phase, setPhase] = useState<Phase>("connecting");
  const [round, setRound] = useState<RoundView | null>(null);
  const [myPick, setMyPick] = useState<number | null>(null);
  const [oppLocked, setOppLocked] = useState(false);
  const [reveal, setReveal] = useState<RevealView | null>(null);
  const [over, setOver] = useState<{ youWon: boolean; deadHeat: boolean } | null>(null);
  const [hp, setHp] = useState({ you: HP_MAX, bot: HP_MAX });
  const [flat, setFlat] = useState(false); // the pack can't form a fair round at all

  const current = useRef<ClashRound | null>(null); // the round WITH its answer — never rendered
  const pickRef = useRef<number | null>(null);
  const botPickRef = useRef<number | null>(null);
  const hpRef = useRef({ you: HP_MAX, bot: HP_MAX });
  const numRef = useRef(0);
  const timers = useRef<number[]>([]);
  const nextDraw = useRef<Promise<ClashRound | null> | null>(null);
  const pending = useRef<(() => void) | null>(null); // what the current reveal leads to
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      for (const t of timers.current) window.clearTimeout(t);
    };
  }, []);

  const draw = useCallback(
    () => (asset ? makeShowableRound(asset, { engine, fameBias, lens }) : Promise.resolve(null)),
    [asset, engine, fameBias, lens],
  );

  // These three call each other in a cycle (start → resolve → advance → start), so they are
  // FUNCTION DECLARATIONS: hoisting lets them reference each other without a ref dance, and
  // they need no referential stability because every value they touch is a ref.
  function clearTimers() {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }
  function after(ms: number, fn: () => void) {
    timers.current.push(window.setTimeout(fn, ms));
  }

  /** Put a freshly-dealt round on the board and start its clock + the bot's timer. */
  function startRound(r: ClashRound | null) {
    if (!live.current) return;
    if (!r) {
      setFlat(true); // nothing fair to deal — the board shows the "pack too small" state
      return;
    }
    current.current = r;
    pickRef.current = null;
    botPickRef.current = null;
    numRef.current += 1;
    setMyPick(null);
    setOppLocked(false);
    setReveal(null);
    setRound({
      num: numRef.current,
      center: { common: r.center.common, sci: r.center.sci },
      options: [
        { common: r.options[0].common, sci: r.options[0].sci },
        { common: r.options[1].common, sci: r.options[1].sci },
      ],
      deadline: Date.now() / 1000 + ROUND_SECONDS,
      seconds: ROUND_SECONDS,
    });
    setPhase("playing");

    // The bot: "extremely efficient" — its accuracy and delay come from the ENGINE, so the
    // thresholds stay in the engine's own units and a new metric brings its own.
    const policy = engine.bot(r.gap);
    const choice = Math.random() < policy.accuracy ? r.correct : r.correct ^ 1;
    after(BOT_DELAY_MIN_MS + Math.random() * BOT_DELAY_JITTER_MS + policy.delayBiasMs, () => {
      botPickRef.current = choice;
      setOppLocked(true);
      if (pickRef.current !== null) resolve(); // both locked → reveal now
    });
    after(ROUND_SECONDS * 1000, resolve); // time up → reveal regardless of locks
  }

  /** Grade the round: the difference model, then linger on the reveal. */
  function resolve() {
    const r = current.current;
    if (!r || !live.current) return;
    current.current = null; // idempotent — a lock and the deadline can both land here
    clearTimers();

    // Only a DIFFERING outcome deals damage: both right, or both wrong, is a wash. A null pick
    // (the clock ran out) counts as a miss. Mirrors referee.py's resolve.
    const youMiss = pickRef.current !== r.correct;
    const botMiss = botPickRef.current !== r.correct;
    const dmg = engine.damage(r.gap);
    const iBled = youMiss && !botMiss;
    const oppBled = botMiss && !youMiss;
    const next = {
      you: Math.max(0, hpRef.current.you - (iBled ? dmg : 0)),
      bot: Math.max(0, hpRef.current.bot - (oppBled ? dmg : 0)),
    };
    hpRef.current = next;
    setHp(next);
    setReveal({
      correct: r.correct,
      myPick: pickRef.current,
      oppPick: botPickRef.current,
      mrcaRank: [r.rel[0].mrcaRank ?? null, r.rel[1].mrcaRank ?? null],
      damage: dmg,
      iBled,
      oppBled,
    });
    setPhase("revealed");

    // What the reveal leads to, held so that skipping it does the SAME thing early rather
    // than a different thing — skipping the last reveal must end the match, not deal round 21.
    if (next.you <= 0 || next.bot <= 0 || numRef.current >= ROUND_CAP) {
      pending.current = () => {
        setOver({
          youWon: next.you > 0 && (next.bot <= 0 || next.you > next.bot),
          deadHeat: next.you > 0 && next.bot > 0 && next.you === next.bot,
        });
        setPhase("over");
      };
    } else {
      // Deal the next round DURING the reveal: screening it for showable species is a network
      // call, and the reveal is exactly the pause that hides it.
      nextDraw.current = draw();
      pending.current = advance;
    }
    after(REVEAL_MS, runPending);
  }

  /** Run whatever the reveal was waiting to do, exactly once. */
  function runPending() {
    if (!live.current) return;
    const next = pending.current;
    pending.current = null;
    clearTimers();
    next?.();
  }

  function advance() {
    const coming = nextDraw.current ?? draw();
    nextDraw.current = null;
    coming.then(startRound);
  }

  const start = useCallback(() => {
    clearTimers();
    hpRef.current = { you: HP_MAX, bot: HP_MAX };
    numRef.current = 0;
    current.current = null;
    nextDraw.current = null;
    pending.current = null;
    setHp(hpRef.current);
    setOver(null);
    setReveal(null);
    setRound(null);
    setFlat(false);
    setPhase("connecting");
    draw().then(startRound);
    // startRound is a hoisted declaration recreated each render but reads only refs — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw]);

  // Open the match, and start over if the pack or the draw parameters change.
  useEffect(() => {
    if (asset) start();
  }, [asset, start]);

  return {
    phase,
    // "Connected" for a local match means a round is on the board (or the match is done, or
    // the pack turned out to be unplayable) — the board's waiting state keys off this.
    connected: round !== null || phase === "over" || flat,
    ranked: false, // solo and vs-bot never rank (docs/clade-clash-design.md security model)
    you: { id: "you", display: "You", hp: hp.you },
    opp: { id: "bot", display: "Bot", hp: hp.bot },
    round,
    myPick,
    oppLocked,
    reveal,
    over,
    opponentLeft: false,
    lens,
    lock: (side: number) => {
      if (!current.current || pickRef.current !== null) return;
      pickRef.current = side;
      setMyPick(side);
      if (botPickRef.current !== null) resolve(); // opponent already in → reveal now
    },
    skipReveal: () => {
      if (phase === "revealed") runPending();
    },
    playAgain: start,
  };
}
