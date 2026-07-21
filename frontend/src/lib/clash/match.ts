// What a Clade Clash match looks like to the board, whoever is running it.
//
// Clade Clash is ONE game with several ways to play (docs/clade-clash-design.md), but it was
// built as two: a client-side page for solo/bot and a websocket page for versus, each with its
// own HUD, timer, cards, reveal and game-over card. The game rules are identical — same health
// model, same damage curve, same reveal — so every change had to be made twice, and the two
// drifted (versus never got the reveal figure at all).
//
// So the difference is named instead of duplicated. A **driver** owns the parts that genuinely
// differ — who deals the round, who grades it, and who the opponent is — and presents this one
// view. `ClashBoard` renders a MatchView and knows nothing about where it came from.
//
//   useBotMatch(asset, …)  — deals + grades locally, opponent is the bot   (unranked)
//   useClashMatch(pairing) — the server deals + grades, opponent is a human (ranked)
//
// Adding a third way to play (a daily challenge, a replay viewer) is a third driver, not a
// third board.

import type { NameLens } from "../game/settings";

export type Phase = "connecting" | "playing" | "revealed" | "over";

/** A card's names. Deliberately NOT `AssetTip`: the server sends names, not asset records, and
 *  the board only ever renders names. */
export interface CardTip {
  common: string;
  sci: string;
}

export interface PlayerView {
  id: string;
  display: string;
  hp: number;
}

/** The answer-free projection of a round — exactly what a client may know before the reveal.
 *  The server's `public_round()` produces this shape; the bot driver mirrors it rather than
 *  handing the board the answer early, so the board CANNOT leak what it isn't given. */
export interface RoundView {
  num: number;
  center: CardTip;
  options: [CardTip, CardTip];
  /** epoch seconds — one clock for both drivers, so the timer bar is one component. */
  deadline: number;
  /** the round's full length in seconds, for the timer's denominator */
  seconds: number;
}

export interface RevealView {
  correct: 0 | 1;
  myPick: number | null;
  oppPick: number | null;
  /** each option's MRCA rank with the specimen, parallel to `options` — the reveal figure's
   *  "shares family" labels. */
  mrcaRank: [string | null, string | null];
  damage: number;
  iBled: boolean;
  oppBled: boolean;
}

export interface MatchView {
  phase: Phase;
  /** false while a driver is still getting ready (connecting a socket, dealing a round). */
  connected: boolean;
  ranked: boolean;
  you: PlayerView | null;
  opp: PlayerView | null;
  round: RoundView | null;
  myPick: number | null;
  oppLocked: boolean;
  reveal: RevealView | null;
  over: { youWon: boolean; deadHeat: boolean } | null;
  opponentLeft: boolean;
  /** Which names the cards show. A lobby choice in solo; versus shows both. */
  lens: NameLens;
  lock: (side: number) => void;
  /** Skip the rest of the reveal. Absent where the SERVER owns the clock — one player
   *  skipping ahead would only desync them from the round everyone else is still on. */
  skipReveal?: () => void;
  /** Start another match on the same setup. Absent where "again" means re-queueing. */
  playAgain?: () => void;
}

/** How long a reveal stays up before the next round, in ms. Mirrors REVEAL_SECONDS in
 *  apps/clash/consumers.py — the server dates the next deadline past it, so the two clocks
 *  have to agree. Raised in #144 to leave time to actually read the reveal figure. */
export const REVEAL_MS = 6000;
