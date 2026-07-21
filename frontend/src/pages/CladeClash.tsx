// Clade Clash vs the bot — the solo way to play (#36). A centre species sits between two
// candidates; pick the closer relative before the clock runs out.
//
// UNRANKED, and dealt + graded on the client (`useBotMatch`): nothing is submitted, so a
// modified client only fools itself, and the mode needs no account and no round-trip. The
// board is shared with the ranked human duel (`components/clash/ClashBoard`) — one game, two
// ways to play, one surface. This page's whole job is to load the pack the lobby chose and
// hand a driver to the board.
//
// See docs/clade-clash-design.md.

import { Link } from "react-router-dom";
import { useEffect, useState } from "react";

import { Wordmark } from "../components/Brand";
import { ClashBoard } from "../components/clash/ClashBoard";
import { LeafBackground } from "../components/LeafBackground";
import { LoadingTree } from "../components/LoadingTree";
import { loadAsset, loadHybridAsset, loadMixed, loadRemoteAsset } from "../lib/asset/load";
import { fetchScopes } from "../lib/asset/scopes";
import type { InternedAsset } from "../lib/asset/types";
import { useBotMatch } from "../lib/clash/useBotMatch";
import { engineFor } from "../lib/game/cladeClash";
import { decodeConfig, defaultConfig, encodeConfig, type GameConfig } from "../lib/game/config";
import { useTitle } from "../lib/useTitle";

export function CladeClash() {
  useTitle("Clade Clash");
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [cfg] = useState<GameConfig | null>(() => {
    const code = params.get("c");
    return code ? decodeConfig(code) : null;
  });
  const [asset, setAsset] = useState<InternedAsset | null>(null);

  // Resolve the scope from the lobby config (like Marathon); a bare /clash with no config
  // falls back to the default asset so the mode is always playable/testable.
  useEffect(() => {
    let cancelled = false;
    fetchScopes().then((list) => {
      if (cancelled) return;
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

  // Post-match shortcut into a human duel on the SAME packs.
  const scopes = cfg?.scopes ?? [];
  const versusHref = scopes.length
    ? `/clash/versus?c=${encodeConfig(defaultConfig("clash_solo", { scopes }))}`
    : "/clash/versus";

  if (!asset) return <LoadingTree />;
  return <BotGame asset={asset} cfg={cfg} engineId={params.get("engine")} versusHref={versusHref} />;
}

function BotGame({
  asset,
  cfg,
  engineId,
  versusHref,
}: {
  asset: InternedAsset;
  cfg: GameConfig | null;
  engineId: string | null;
  versusHref: string;
}) {
  const match = useBotMatch(asset, {
    // The metric is resolved through the registry by id, exactly as a duel resolves the
    // `engine_id` it was created with — so shipping a new metric is one registry entry
    // (lib/game/cladeClash.ts#ENGINES) plus its mirror in distance.py, and nothing here.
    // `?engine=nodal` is the dev handle until it graduates into a lobby dial.
    engine: engineFor(engineId),
    // Chosen in the lobby (Names). A pre-existing config code has no nameLens in its delta, so
    // decodeConfig fills it from the defaults — old links keep showing both names.
    lens: cfg?.settings.nameLens ?? "both",
    fameBias: cfg?.settings.fameBias ?? 0,
  });

  // The pack is too small or too flat to form a fair round: the driver reports ready, with no
  // round and no result.
  if (match.connected && !match.round && !match.over) {
    return (
      <Shell>
        <div className="ink-card bg-clade-paper px-8 py-10 text-center">
          <p className="font-hand text-2xl text-clade-ink">This pack is too small for a duel.</p>
          <p className="mt-1 font-mono text-xs text-clade-ink/55">
            Pick a bigger pack (or a mix) and try again.
          </p>
          <Link to="/play/clash_solo" className="btn-play mt-4 inline-block">
            ▶ Back to setup
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <ClashBoard
        match={match}
        // Versus is the same game, not a second one — one Hub card, one lobby (Opponent →
        // Bot | Player). This is just the post-match shortcut, on the same packs.
        exit={
          <Link to={versusHref} className="pill">
            ⚔ Duel a player
          </Link>
        }
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen w-screen flex-col items-center justify-center overflow-hidden bg-clade-bg px-4 py-8">
      <LeafBackground density={16} interactive={false} className="pointer-events-none absolute inset-0 -z-10" />
      <div className="absolute left-4 top-4">
        {/* Wordmark is itself a <Link to="/"> — don't wrap it in another (nested <a>). */}
        <Wordmark size="text-xl" />
      </div>
      {children}
    </div>
  );
}
