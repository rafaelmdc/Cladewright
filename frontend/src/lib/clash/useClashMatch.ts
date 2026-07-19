// Clade Clash versus client (#36 Phase 1): the websocket state machine driving the duel UI.
// The SERVER is the referee — it draws every round, owns the countdown, and grades — so this
// hook is thin: it connects, renders whatever the server sends, and sends lock-ins. It never
// decides the answer (the reveal comes from the server).
//
// Protocol (server -> client): match (snapshot) · round (new round) · you_locked/opponent_locked
// · reveal (correct, picks, hp, damage, next?) · opponent_left. Client -> server: {type:"lock", side}.

import { useCallback, useEffect, useRef, useState } from "react";

import type { Pairing } from "./matchmaking";

export interface Tip {
  id: string;
  common: string;
  sci: string;
}
export interface PublicRound {
  num: number;
  center: Tip;
  options: [Tip, Tip];
  deadline: number; // server epoch SECONDS
  seconds: number; // full round length
}
interface PlayerView {
  id: string;
  display: string;
  hp: number;
}
export type Phase = "connecting" | "playing" | "revealed" | "over";

export interface RevealView {
  correct: 0 | 1;
  myPick: number | null;
  oppPick: number | null;
  mrcaRank: [string | null, string | null];
  damage: number;
  iBled: boolean;
  oppBled: boolean;
}

export interface MatchView {
  phase: Phase;
  connected: boolean;
  ranked: boolean;
  you: PlayerView | null;
  opp: PlayerView | null;
  round: PublicRound | null;
  myPick: number | null;
  oppLocked: boolean;
  reveal: RevealView | null;
  over: { youWon: boolean; deadHeat: boolean } | null;
  opponentLeft: boolean;
  lock: (side: number) => void;
}

// Incoming server messages (only the fields the client reads).
interface SnapshotMsg {
  seat: number;
  ranked: boolean;
  players: PlayerView[];
  round: PublicRound | null;
  status: string;
}
interface RevealMsg {
  correct: 0 | 1;
  picks: Record<string, number | null>;
  mrca_rank: [string | null, string | null];
  damage: number;
  damaged: string[];
  hp: Record<string, number>;
  over: boolean;
  winner: string | null;
  next?: PublicRound;
}

const REVEAL_MS = 2500; // matches the server's REVEAL_SECONDS (next round dated past this)

export function useClashMatch(pairing: Pairing | null): MatchView {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [connected, setConnected] = useState(false);
  const [ranked, setRanked] = useState(true);
  const [you, setYou] = useState<PlayerView | null>(null);
  const [opp, setOpp] = useState<PlayerView | null>(null);
  const [round, setRound] = useState<PublicRound | null>(null);
  const [myPick, setMyPick] = useState<number | null>(null);
  const [oppLocked, setOppLocked] = useState(false);
  const [reveal, setReveal] = useState<RevealView | null>(null);
  const [over, setOver] = useState<{ youWon: boolean; deadHeat: boolean } | null>(null);
  const [opponentLeft, setOpponentLeft] = useState(false);

  const ws = useRef<WebSocket | null>(null);
  const seatRef = useRef(0);
  const meId = useRef<string>("");
  const oppId = useRef<string>("");
  const revealTimer = useRef<number | undefined>(undefined);

  const applySnapshot = useCallback((m: SnapshotMsg) => {
    seatRef.current = m.seat;
    const players: PlayerView[] = m.players;
    meId.current = players[m.seat].id;
    oppId.current = players[1 - m.seat].id;
    setRanked(m.ranked);
    setYou(players[m.seat]);
    setOpp(players[1 - m.seat]);
    if (m.round) {
      setRound(m.round);
      setPhase(m.status === "over" ? "over" : "playing");
    }
  }, []);

  const startRound = useCallback((r: PublicRound) => {
    setRound(r);
    setMyPick(null);
    setOppLocked(false);
    setReveal(null);
    setPhase("playing");
  }, []);

  const applyReveal = useCallback((m: RevealMsg) => {
    const hp = m.hp;
    setYou((y) => (y ? { ...y, hp: hp[meId.current] ?? y.hp } : y));
    setOpp((o) => (o ? { ...o, hp: hp[oppId.current] ?? o.hp } : o));
    setReveal({
      correct: m.correct,
      myPick: m.picks[meId.current] ?? null,
      oppPick: m.picks[oppId.current] ?? null,
      mrcaRank: m.mrca_rank,
      damage: m.damage,
      iBled: (m.damaged || []).includes(meId.current),
      oppBled: (m.damaged || []).includes(oppId.current),
    });
    setPhase("revealed");

    if (m.over) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = window.setTimeout(() => {
        const youWon = m.winner === meId.current;
        setOver({ youWon, deadHeat: m.winner === null });
        setPhase("over");
      }, REVEAL_MS);
    } else if (m.next) {
      const next = m.next;
      window.clearTimeout(revealTimer.current);
      revealTimer.current = window.setTimeout(() => startRound(next), REVEAL_MS);
    }
  }, [startRound]);

  useEffect(() => {
    if (!pairing) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws/clash/match/${pairing.match_id}/?token=${encodeURIComponent(pairing.token)}`;
    const sock = new WebSocket(url);
    ws.current = sock;

    sock.onopen = () => setConnected(true);
    sock.onclose = () => setConnected(false);
    sock.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      switch (m.type) {
        case "match": applySnapshot(m); break;
        case "round": startRound(m.round); break;
        case "you_locked": break; // local optimistic pick already shows this
        case "opponent_locked": setOppLocked(true); break;
        case "reveal": applyReveal(m); break;
        case "opponent_left": setOpponentLeft(true); break;
      }
    };
    return () => {
      window.clearTimeout(revealTimer.current);
      sock.close();
      ws.current = null;
    };
  }, [pairing, applySnapshot, startRound, applyReveal]);

  const lock = useCallback((side: number) => {
    if (phase !== "playing" || myPick !== null) return;
    setMyPick(side); // optimistic — the card shows locked immediately
    ws.current?.send(JSON.stringify({ type: "lock", side }));
  }, [phase, myPick]);

  return {
    phase, connected, ranked, you, opp, round, myPick, oppLocked, reveal, over, opponentLeft, lock,
  };
}
