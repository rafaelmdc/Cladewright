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

import { ClashBoard } from "../components/clash/ClashBoard";
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
import { useClashMatch } from "../lib/clash/useClashMatch";
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
  // Once paired, the duel owns the screen — on the same board solo plays on.
  if (pairing) {
    return (
      <Shell>
        <ClashBoard
          match={match}
          exit={
            <button onClick={rematch} className="btn-play">
              ▶ New match
            </button>
          }
        />
      </Shell>
    );
  }

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

// ── presentational (the board itself lives in components/clash/ClashBoard) ─────────────

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
