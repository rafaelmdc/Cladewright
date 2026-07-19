// Clade Clash — realtime versus (#36 Phase 1). Pick a pack, then quick-match a stranger or
// invite a friend by room code; the duel itself is server-refereed over a websocket
// (useClashMatch). The board mirrors Phase 0's solo look — facing HP bars, a specimen, two
// candidates — but the opponent is a person and every reveal comes from the server.

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { LeafBackground } from "../components/LeafBackground";
import { Wordmark } from "../components/Brand";
import { ScopePicker } from "../components/ScopePicker";
import { fetchMe } from "../lib/auth";
import { defaultConfig, encodeConfig } from "../lib/game/config";
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
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  const [scope, setScope] = useState<string>("");
  const [stage, setStage] = useState<Stage>("setup");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null); // code WE are hosting
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const match = useClashMatch(pairing);

  useEffect(() => {
    fetchMe().then((m) => setAuthed(m.authenticated));
    fetchScopes().then((list) => {
      setScopes(list);
      setScope((s) => s || list[0]?.key || "");
    });
  }, []);

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
      const r = await quickMatch(scope);
      if (isPairing(r)) setPairing(r);
      else setStage("searching");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [scope]);

  const onCreateRoom = useCallback(async () => {
    setError(null);
    try {
      setRoomCode(await createRoom(scope));
      setStage("searching");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [scope]);

  const onJoinRoom = useCallback(async () => {
    setError(null);
    try {
      setPairing(await joinRoom(joinCode.trim()));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [joinCode]);

  const cancel = useCallback(() => {
    if (!roomCode) leaveQueue(scope);
    setStage("setup");
    setRoomCode(null);
  }, [roomCode, scope]);

  const rematch = useCallback(() => {
    setPairing(null);
    setRoomCode(null);
    setStage("setup");
  }, []);

  // Duel a bot — client-side, instant, no wait and no server load (it's unranked, and the
  // answer is derivable locally anyway). Reuses the Phase 0 solo health-duel on the chosen
  // pack: an "extremely efficient" opponent you can play the moment you land here.
  const playBot = useCallback(() => {
    if (!scope) return;
    navigate(`/clash?c=${encodeConfig(defaultConfig("clash_solo", { scopes: [scope] }))}`);
  }, [scope, navigate]);

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

        <div className="mt-5">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">Pack</p>
          <ScopePicker scopes={scopes} value={scope ? [scope] : []} onChange={(k) => setScope(k[k.length - 1] ?? "")} multiple={false} />
        </div>

        {/* Bot duel is client-side + unranked, so it needs no account and no waiting. */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button onClick={playBot} disabled={!scope} className="btn-play text-xl disabled:opacity-50">🤖 Play a bot</button>
          <span className="font-mono text-[11px] text-clade-ink/40">instant · unranked</span>
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
              <button onClick={onQuick} disabled={!scope} className="btn-play disabled:opacity-50">⚔ Quick match</button>
              <button onClick={onCreateRoom} disabled={!scope} className="pill disabled:opacity-50">Invite a friend</button>
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
          {you && <VsHpBar label={you.display} hp={you.hp} highlight={over.youWon} />}
          {opp && <VsHpBar label={opp.display} hp={opp.hp} highlight={!over.youWon && !over.deadHeat} reverse />}
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
        <VsHpBar label={you.display} hp={you.hp} dmg={phase === "revealed" && reveal?.iBled ? reveal.damage : 0} highlight />
        <div className="shrink-0 pb-1 text-center font-mono text-[11px] uppercase tracking-widest text-clade-ink/45">
          R{round.num}
          {!ranked && <div className="text-[9px] text-amber-600">unranked</div>}
        </div>
        <VsHpBar label={opp.display} hp={opp.hp} dmg={phase === "revealed" && reveal?.oppBled ? reveal.damage : 0} reverse />
      </div>

      <Timer round={round} frozen={phase !== "playing"} />

      <div className="grid w-full grid-cols-1 items-stretch gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <VsOptionCard tip={round.options[0]} side={0} phase={phase} myPick={myPick} reveal={reveal} onPick={() => match.lock(0)} />
        <div className="flex flex-col items-center justify-center gap-2">
          <VsCenterCard tip={round.center} />
          <div className="font-hand text-lg italic text-clade-ink/40">closer to…?</div>
        </div>
        <VsOptionCard tip={round.options[1]} side={1} phase={phase} myPick={myPick} reveal={reveal} onPick={() => match.lock(1)} />
      </div>

      <div className="mt-4 h-5 font-mono text-xs uppercase tracking-widest text-clade-ink/40">
        {opponentLeft ? "opponent left — play it out" : phase === "playing"
          ? myPick === null ? "pick the closer relative" : oppLocked ? "revealing…" : "locked in — waiting on your opponent"
          : ""}
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

function VsCenterCard({ tip }: { tip: { common: string; sci: string } }) {
  return (
    <div className="ink-card w-52 max-w-full bg-clade-paper px-4 py-4 text-center shadow-sm">
      <div className="font-mono text-[10px] uppercase tracking-widest text-clade-accent">Specimen</div>
      <div className="mt-1 font-hand text-2xl font-bold leading-tight text-clade-ink">{tip.common}</div>
      <div className="font-hand text-sm italic text-clade-ink/55">{tip.sci}</div>
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
      : "border-red-400/60 opacity-70";
  return (
    <button
      type="button"
      disabled={phase !== "playing" || myPick !== null}
      onClick={onPick}
      className={`ink-card relative flex min-h-[9rem] flex-col items-center justify-center gap-1 bg-clade-paper px-4 py-5 text-center transition ${tone} ${phase === "playing" && myPick === null ? "cursor-pointer" : "cursor-default"}`}
    >
      <div className="font-hand text-2xl font-bold leading-tight text-clade-ink">{tip.common}</div>
      <div className="font-hand text-sm italic text-clade-ink/55">{tip.sci}</div>
      {picked && !revealed && (
        <span className="absolute right-2 top-2 rounded-full bg-clade-accent px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-clade-paper">you</span>
      )}
      {revealed && reveal && (
        <div className="mt-2 flex flex-col items-center gap-1">
          <span className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${isCorrect ? "bg-clade-accent text-clade-paper" : "border border-red-400/60 text-red-600"}`}>
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

function VsHpBar({ label, hp, dmg = 0, reverse, highlight }: { label: string; hp: number; dmg?: number; reverse?: boolean; highlight?: boolean }) {
  const pct = Math.max(0, Math.min(100, hp)); // HP_MAX is 100
  const color = hp <= 25 ? "bg-red-500" : hp <= 55 ? "bg-amber-500" : "bg-clade-accent";
  return (
    <div className="flex-1">
      <div className={`flex items-baseline justify-between font-mono text-[10px] uppercase tracking-widest ${reverse ? "flex-row-reverse" : ""}`}>
        <span className={`truncate ${highlight ? "text-clade-accent" : "text-clade-ink/50"}`}>{label}</span>
        <span className="tabular-nums text-clade-ink/60">
          {dmg > 0 && <span className="mr-1 text-red-500">−{dmg}</span>}
          {Math.max(0, Math.round(hp))}
        </span>
      </div>
      <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-clade-ink/10">
        <div className={`absolute inset-y-0 ${reverse ? "right-0" : "left-0"} rounded-full ${color} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

