// Clade Clash — realtime versus (#36 Phase 1). Quick-match a stranger or invite a friend by
// room code; the duel itself is server-refereed over a websocket (useClashMatch). The board
// mirrors solo's look — facing HP bars, a specimen, two candidates — but the opponent is a
// person and every reveal comes from the server.
//
// The PACK is chosen in the Clade Clash lobby (/play/clash_solo, Opponent → Player) and
// arrives here as ?c=<encoded GameConfig>, exactly like the solo surface. Versus is not a
// separate game with its own setup — it's one way to play Clade Clash. The inline picker
// below is only a fallback for a bare /clash/versus (an old bookmark or shared link).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { HealthGauge } from "../components/clash/HealthGauge";
import { RevealCountdown } from "../components/clash/RevealCountdown";
import { SpecimenPlate } from "../components/clash/SpecimenPlate";
import { LeafBackground } from "../components/LeafBackground";
import { Wordmark } from "../components/Brand";
import { ScopePicker } from "../components/ScopePicker";
import { fetchMe } from "../lib/auth";
import { decodeConfig } from "../lib/game/config";
import { fetchScopes, type ScopeInfo } from "../lib/asset/scopes";
import {
  createRoom,
  isPairing,
  joinRoom,
  leaveQueue,
  type Pairing,
  pollPairing,
  quickMatch,
} from "../lib/clash/matchmaking";
import { REVEAL_MS } from "../lib/clash/useClashMatch";
import {
  type MatchView,
  type Phase,
  type PublicRound,
  type RevealView,
  useClashMatch,
} from "../lib/clash/useClashMatch";
import { useTitle } from "../lib/useTitle";

type Stage = "setup" | "searching";

export function ClashVersus() {
  useTitle("Clade Clash · Versus");
  const navigate = useNavigate();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [params] = useSearchParams();
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  // The chosen pack(s) — a duel may run on a MIX, like a Time Attack run (#147).
  const [picked, setPicked] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>("setup");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null); // code WE are hosting
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const match = useClashMatch(pairing);

  // The packs come from the lobby as ?c=<config>. Only fall back to the first available pack
  // when there's no config at all (a bare /clash/versus), so the inline picker has a value.
  const lobbyScopes = useMemo(() => {
    const code = params.get("c");
    const cfg = code ? decodeConfig(code) : null;
    return cfg?.scopes ?? [];
  }, [params]);

  useEffect(() => {
    fetchMe().then((m) => setAuthed(m.authenticated));
    fetchScopes().then((list) => {
      setScopes(list);
      setPicked((p) => (p.length ? p : lobbyScopes.length ? lobbyScopes : [list[0]?.key].filter(Boolean) as string[]));
    });
  }, [lobbyScopes]);

  // While searching (queued or hosting a room), poll for the pairing.
  useEffect(() => {
    if (stage !== "searching" || pairing) return;
    let alive = true;
    const id = window.setInterval(async () => {
      const r = await pollPairing();
      if (alive && isPairing(r)) setPairing(r);
    }, 1500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [stage, pairing]);

  const onQuick = useCallback(async () => {
    setError(null);
    try {
      const r = await quickMatch(picked);
      if (isPairing(r)) setPairing(r);
      else setStage("searching");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [picked]);

  const onCreateRoom = useCallback(async () => {
    setError(null);
    try {
      setRoomCode(await createRoom(picked));
      setStage("searching");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [picked]);

  const onJoinRoom = useCallback(async () => {
    setError(null);
    try {
      setPairing(await joinRoom(joinCode.trim()));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [joinCode]);

  const cancel = useCallback(() => {
    if (!roomCode) leaveQueue(picked);
    setStage("setup");
    setRoomCode(null);
  }, [roomCode, picked]);

  const rematch = useCallback(() => {
    setPairing(null);
    setRoomCode(null);
    setStage("setup");
  }, []);

  /** Back to the one Clade Clash lobby, where packs + opponent are chosen. */
  const toLobby = useCallback(() => navigate("/play/clash_solo"), [navigate]);

  // Once paired, the duel owns the screen.
  if (pairing) return <Shell><Duel match={match} onExit={rematch} /></Shell>;

  if (stage === "searching") {
    return (
      <Shell>
        <Card>
          <div className="font-mono text-[11px] uppercase tracking-widest text-clade-accent">
            {roomCode ? "Room open" : "Finding an opponent…"}
          </div>
          {roomCode ? (
            <>
              <p className="mt-2 font-hand text-xl text-clade-ink/70">Share this code with a friend:</p>
              <div className="mt-3 select-all rounded-lg border-2 border-dashed border-clade-ink/25 px-6 py-3 font-mono text-4xl font-bold tracking-[0.3em] text-clade-ink">
                {roomCode}
              </div>
            </>
          ) : (
            <p className="mt-3 font-hand text-2xl text-clade-ink animate-pulse">searching…</p>
          )}
          <button onClick={cancel} className="mt-6 font-mono text-xs uppercase tracking-widest text-clade-ink/50 hover:text-clade-ink">
            ← Cancel
          </button>
        </Card>
      </Shell>
    );
  }

  // setup
  return (
    <Shell>
      <Card wide>
        <Link to="/" className="font-mono text-[11px] uppercase tracking-widest text-clade-ink/40 hover:text-clade-ink">← Games</Link>
        <h1 className="mt-1 font-hand text-5xl font-bold text-clade-ink">Clade Clash · Versus</h1>
        <p className="font-hand text-xl text-clade-ink/70">Spot the closer relative faster than your opponent. First to lose all health is out.</p>

        {/* The pack normally arrives from the lobby, so just show it and offer a way back.
            Only a bare /clash/versus (old bookmark) falls through to the inline picker. */}
        <div className="mt-5">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">Pack</p>
          {lobbyScopes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              {picked.map((k) => (
                <span key={k} className="pill pill-active">
                  {scopes.find((s) => s.key === k)?.label ?? k}
                </span>
              ))}
              <button onClick={toLobby} className="font-mono text-[11px] uppercase tracking-widest text-clade-ink/45 underline-offset-2 hover:text-clade-ink hover:underline">
                change in lobby
              </button>
            </div>
          ) : (
            <ScopePicker scopes={scopes} value={picked} onChange={setPicked} />
          )}
          {picked.length > 1 && (
            <p className="mt-2 font-mono text-[11px] text-clade-ink/45">
              Quick match pairs you with someone on this exact mix — a room code is the sure
              way to duel a friend on it.
            </p>
          )}
        </div>

        {/* Ranked human duels need an account. */}
        <div className="mt-6 border-t border-clade-ink/10 pt-5">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">Ranked · vs people</p>
          {authed === false ? (
            <p className="font-hand text-lg text-clade-ink/70">
              <Link to="/login" className="text-clade-accent underline underline-offset-2">Sign in</Link> to duel real players — ranked matches need an account.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={onQuick} disabled={picked.length === 0} className="btn-play disabled:opacity-50">⚔ Quick match</button>
              <button onClick={onCreateRoom} disabled={picked.length === 0} className="pill disabled:opacity-50">Invite a friend</button>
              <div className="flex items-center gap-2">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ROOM CODE"
                  maxLength={6}
                  className="w-32 rounded-lg border border-clade-ink/20 bg-clade-paper px-3 py-1.5 font-mono uppercase tracking-widest text-clade-ink placeholder:text-clade-ink/30"
                />
                <button onClick={onJoinRoom} disabled={joinCode.length < 6} className="pill disabled:opacity-40">Join</button>
              </div>
            </div>
          )}
        </div>
        {error && <p className="mt-3 font-mono text-xs text-red-600">{error}</p>}
      </Card>
    </Shell>
  );
}

// ── duel ──────────────────────────────────────────────────────────────────────────────

function Duel({ match, onExit }: { match: MatchView; onExit: () => void }) {
  const { phase, you, opp, round, myPick, oppLocked, reveal, over, opponentLeft, ranked } = match;

  if (!match.connected && phase === "connecting") {
    return <Card><p className="font-hand text-2xl text-clade-ink animate-pulse">connecting…</p></Card>;
  }

  if (phase === "over" && over) {
    const label = over.deadHeat ? "Dead heat" : over.youWon ? "You win" : "You lose";
    return (
      <Card>
        <div className="font-mono text-[11px] uppercase tracking-widest text-clade-ink/45">Match over</div>
        <h1 className={`mt-1 font-hand text-5xl font-bold ${over.youWon ? "text-clade-accent" : "text-clade-ink"}`}>{label}</h1>
        <div className="mt-6 flex flex-col gap-3">
          {you && <HealthGauge label={you.display} hp={you.hp} highlight={over.youWon} />}
          {opp && <HealthGauge label={opp.display} hp={opp.hp} highlight={!over.youWon && !over.deadHeat} reverse />}
        </div>
        <div className="mt-7 flex items-center justify-center gap-3">
          <button onClick={onExit} className="btn-play">▶ New match</button>
          <Link to="/" className="font-mono text-xs uppercase tracking-widest text-clade-ink/50 hover:text-clade-ink">Menu</Link>
        </div>
      </Card>
    );
  }

  if (!round || !you || !opp) {
    return <Card><p className="font-hand text-2xl text-clade-ink animate-pulse">waiting for opponent…</p></Card>;
  }

  return (
    <div className="flex w-full max-w-3xl flex-col items-center">
      <div className="mb-4 flex w-full items-end gap-4">
        <HealthGauge label={you.display} hp={you.hp} dmg={phase === "revealed" && reveal?.iBled ? reveal.damage : 0} highlight />
        <div className="shrink-0 pb-1 text-center font-mono text-[11px] uppercase tracking-widest text-clade-ink/45">
          R{round.num}
          {!ranked && <div className="text-[9px] text-amber-600">unranked</div>}
        </div>
        <HealthGauge label={opp.display} hp={opp.hp} dmg={phase === "revealed" && reveal?.oppBled ? reveal.damage : 0} reverse />
      </div>

      <Timer round={round} frozen={phase !== "playing"} />

      <div className="grid w-full grid-cols-1 items-stretch gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <VsOptionCard tip={round.options[0]} side={0} phase={phase} myPick={myPick} reveal={reveal} onPick={() => match.lock(0)} />
        <div className="flex flex-col items-center justify-center gap-2">
          <VsCenterCard tip={round.center} spoil={phase === "revealed"} />
          <div className="font-hand text-lg italic text-clade-ink/40">closer to…?</div>
        </div>
        <VsOptionCard tip={round.options[1]} side={1} phase={phase} myPick={myPick} reveal={reveal} onPick={() => match.lock(1)} />
      </div>

      <div className="mt-4 flex h-7 items-center font-mono text-xs uppercase tracking-widest text-clade-ink/40">
        {opponentLeft ? "opponent left — play it out" : phase === "playing"
          ? myPick === null ? "pick the closer relative" : oppLocked ? "revealing…" : "locked in — waiting on your opponent"
          /* No skip here: the server owns the clock, and one player skipping ahead would just
             desync them from the round everyone else is still on. */
          : <RevealCountdown ms={REVEAL_MS} />}
      </div>
    </div>
  );
}

function Timer({ round, frozen }: { round: PublicRound; frozen: boolean }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (frozen) return;
    const id = window.setInterval(() => setNow(Date.now() / 1000), 200);
    return () => window.clearInterval(id);
  }, [frozen, round.num]);
  const left = Math.max(0, round.deadline - now);
  const frac = frozen ? 1 : Math.max(0, Math.min(1, left / round.seconds));
  return (
    <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-clade-ink/10">
      <div
        className={`h-full rounded-full transition-[width] duration-200 ease-linear ${left <= 3 && !frozen ? "bg-red-500" : "bg-clade-accent"}`}
        style={{ width: `${frac * 100}%` }}
      />
    </div>
  );
}

// ── presentational (self-contained; the server drives the reveal) ───────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen w-screen flex-col items-center justify-center overflow-hidden bg-clade-bg px-4 py-8">
      <LeafBackground density={16} interactive={false} className="pointer-events-none absolute inset-0 -z-10" />
      <div className="absolute left-4 top-4"><Wordmark size="text-xl" /></div>
      {children}
    </div>
  );
}

function Card({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`ink-card bg-clade-paper px-8 py-8 text-center ${wide ? "w-[34rem] max-w-full text-left" : "w-[22rem] max-w-full"}`}>
      {children}
    </div>
  );
}

function VsCenterCard({ tip, spoil }: { tip: { common: string; sci: string }; spoil: boolean }) {
  return (
    <div className="ink-card w-52 max-w-full overflow-hidden bg-clade-paper p-0 shadow-sm">
      <div className="border-b-2 border-clade-ink/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-clade-accent">
        Specimen
      </div>
      {/* The duel's rounds come from the server, which sends both names, so the plate shows
          both — the lobby's Names lens applies to solo play. */}
      <SpecimenPlate common={tip.common} sci={tip.sci} lens="both" compact spoil={spoil} />
    </div>
  );
}

function VsOptionCard({
  tip, side, phase, myPick, reveal, onPick,
}: {
  tip: { common: string; sci: string };
  side: 0 | 1;
  phase: Phase;
  myPick: number | null;
  reveal: RevealView | null;
  onPick: () => void;
}) {
  const revealed = phase === "revealed";
  const isCorrect = reveal?.correct === side;
  const picked = myPick === side;
  const tone = !revealed
    ? picked
      ? "border-clade-accent ring-2 ring-clade-accent/40"
      : "border-clade-ink/15 hover:border-clade-ink/40"
    : isCorrect
      ? "border-clade-accent ring-2 ring-clade-accent"
      : "border-clade-ink/15 opacity-60 grayscale";
  return (
    <button
      type="button"
      /* NOT `disabled`: a disabled button emits no pointer events in Chrome, which would kill
         the hover zoom on a spent card — including during the reveal. `lock()` guards the pick. */
      aria-disabled={phase !== "playing" || myPick !== null}
      onClick={onPick}
      className={`ink-card relative flex flex-col overflow-hidden bg-clade-paper p-0 text-left transition ${tone} ${phase === "playing" && myPick === null ? "cursor-pointer" : "cursor-default"}`}
    >
      <SpecimenPlate common={tip.common} sci={tip.sci} lens="both" spoil={revealed} />
      {picked && !revealed && (
        <span className="absolute right-2 top-2 rounded-full bg-clade-accent px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-clade-paper">you</span>
      )}
      {revealed && reveal && (
        <div className="flex flex-col items-center gap-1 border-t-2 border-clade-ink/10 px-3 py-2">
          <span className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${isCorrect ? "bg-clade-accent text-clade-paper" : "border border-clade-ink/25 text-clade-ink/55"}`}>
            {isCorrect ? "closer" : "further"}
            {reveal.mrcaRank[side] ? ` · shares ${reveal.mrcaRank[side]}` : ""}
          </span>
          <div className="flex gap-1">
            {reveal.myPick === side && <VsTag label="you" good={isCorrect} />}
            {reveal.oppPick === side && <VsTag label="them" good={isCorrect} muted />}
          </div>
        </div>
      )}
    </button>
  );
}

function VsTag({ label, good, muted }: { label: string; good: boolean; muted?: boolean }) {
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${good ? "text-clade-accent" : "text-red-500"} ${muted ? "opacity-70" : ""}`}>
      {label} {good ? "✓" : "✗"}
    </span>
  );
}
