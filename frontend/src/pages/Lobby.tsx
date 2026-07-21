// The per-game setup page (/play/:mode) — pick pack(s), difficulty, and settings, then Start.
// This is the single-player shape of a future multiplayer room: internally it's
// { config, players:[you], status }, but the UI shows NO player list while it's solo (that's
// just awkward) — participants surface only once real multiplayer exists. Start builds a
// GameConfig and threads it (encoded) to the play surface. See docs/lobby-and-config.md.

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { TopBar } from "../components/Brand";
import { ScopePicker } from "../components/ScopePicker";
import { LeafBackground } from "../components/LeafBackground";
import { SettingsFields } from "../components/controls/SettingControls";
import { fetchScopes, type ScopeInfo } from "../lib/asset/scopes";
import { fetchSets, type SetInfo } from "../lib/asset/sets";
import { fetchGames, FALLBACK_GAMES, type Game } from "../lib/games";
import {
  decodeConfig,
  defaultConfig,
  encodeConfig,
  type GameConfig,
} from "../lib/game/config";
import { gameplayFields, opponentsFor, type OpponentChoice } from "../lib/game/schema";
import { fetchGameDefaults, gameDefaults, type GameSettings } from "../lib/game/settings";
import {
  conflictingModifiers,
  fetchModifiers,
  formatMultiplier,
  modifierEffects,
  previewMultiplier,
  type ModifierInfo,
} from "../lib/game/multipliers";
import type { Difficulty } from "../lib/scores";
import { useTitle } from "../lib/useTitle";

// One stored config per game, so the lobby reopens where you left it.
const configKey = (mode: string) => `cladewright.config.${mode}`;

/** Whether the current scope selection is exactly a set's members (order-independent), so the
 *  lobby can highlight the matching set chip. */
function sameScopes(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((k) => set.has(k));
}

export function Lobby() {
  const { mode = "marathon_free" } = useParams();
  const navigate = useNavigate();
  const [games, setGames] = useState<Game[]>(FALLBACK_GAMES);
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  const [sets, setSets] = useState<SetInfo[]>([]);
  const [modInfo, setModInfo] = useState<ModifierInfo | null>(null);
  const [cfg, setCfg] = useState<GameConfig>(() => seedConfig(mode));

  const game = games.find((g) => g.mode === mode);
  useTitle(game ? `${game.label} · set up` : "Set up");

  // Pull admin-configured defaults so the dials (and the encoded delta) reflect them, not just
  // the hardcoded fallbacks. If the lobby opened before they landed and there's no stored
  // config, re-seed the settings once they're in.
  useEffect(() => {
    fetchGameDefaults(mode).finally(() => {
      if (!localStorage.getItem(configKey(mode))) {
        setCfg((c) => ({ ...c, settings: { ...gameDefaults() } }));
      }
    });
  }, [mode]);

  // The game's modifiers + multiplier rules, for the chips + the live multiplier preview.
  useEffect(() => {
    fetchModifiers(mode).then((info) => {
      setModInfo(info);
      // Drop any remembered modifier the backend no longer serves.
      setCfg((c) => {
        const valid = c.modifiers.filter((k) => info.modifiers.some((m) => m.key === k));
        return valid.length === c.modifiers.length ? c : { ...c, modifiers: valid };
      });
    });
  }, [mode]);

  useEffect(() => {
    fetchGames().then(setGames);
    // All scopes are pickable packs, and any mode mixes: blob pools merge client-side while
    // hybrid/remote ("streamed") packs add their notable subset + a network tail (loadMixed).
    fetchScopes().then((list) => {
      setScopes(list);
      // Drop any remembered scope the backend no longer serves; seed one if none valid.
      setCfg((c) => {
        const valid = c.scopes.filter((k) => list.some((s) => s.key === k));
        const next = valid.length ? valid : list[0] ? [list[0].key] : [];
        return { ...c, scopes: next };
      });
    });
    // Admin-curated pack sets (#120) — one-click presets over the scope mix.
    fetchSets().then(setSets);
  }, []);

  const supportsDifficulty = game?.supports_difficulty ?? true;
  // Games that ask who you're playing against (Clade Clash). Empty for everything else, so
  // the panel simply doesn't render and Start keeps using the game's own route.
  const opponents = useMemo(() => opponentsFor(mode), [mode]);
  const opponent = opponents.find((o) => o.value === (cfg.opponent ?? "bot")) ?? opponents[0];
  const totalTips = scopes
    .filter((s) => cfg.scopes.includes(s.key))
    .reduce((n, s) => n + s.tip_count, 0);
  // What the active modifiers do to the settings (admin data): drop `hidden` dials, pin `forced`
  // ones. Forced values are shown as a locked overlay — the player's own cfg.settings is left
  // intact, so toggling the modifier off restores them.
  const effects = modInfo
    ? modifierEffects(cfg.modifiers, modInfo)
    : { hidden: new Set<keyof GameSettings>(), forced: {} as Partial<GameSettings> };
  const fields = useMemo(() => gameplayFields(mode, effects.hidden), [mode, effects.hidden]);
  // Some modes (e.g. Clade Clash) tune only their pack scope — no gameplay dials. Then the
  // right-hand Settings panel is empty, so drop it and let the pack column run full width.
  const hasSettings = fields.length > 0;
  const shownSettings = { ...cfg.settings, ...effects.forced };
  const lockedKeys = new Set(Object.keys(effects.forced) as (keyof GameSettings)[]);
  // Live score multiplier the run will score at (∏ active modifiers × ∏ eased settings, #101).
  const multiplier = modInfo ? previewMultiplier(cfg.modifiers, cfg.settings, modInfo) : 1;
  const conflicts = modInfo ? conflictingModifiers(cfg.modifiers, modInfo.modifiers) : new Set<string>();
  // Whether the gameplay settings are still at the (admin-overlaid) defaults — the reset button
  // only appears once the player has changed something.
  const atDefaults = (() => {
    const def = gameDefaults() as unknown as Record<string, unknown>;
    const cur = cfg.settings as unknown as Record<string, unknown>;
    return Object.keys(def).every((k) => def[k] === cur[k]);
  })();

  function toggleModifier(key: string) {
    setCfg((c) => {
      const has = c.modifiers.includes(key);
      const next = has ? c.modifiers.filter((k) => k !== key) : [...c.modifiers, key];
      return { ...c, modifiers: next.sort() };
    });
  }

  function pickOpponent(o: OpponentChoice) {
    setCfg((c) => ({ ...c, opponent: o.value }));
  }

  function start() {
    const code = encodeConfig(cfg);
    try {
      localStorage.setItem(configKey(mode), code);
    } catch {
      /* storage unavailable — the run still launches, the lobby just won't pre-fill next time */
    }
    // Games that offer opponents route by the choice (Clade Clash: bot → /clash, player →
    // /clash/versus); everything else goes to the game's own route. Either way the encoded
    // config rides along, so the target inherits the packs and settings picked here.
    const route = opponent?.route ?? game?.route ?? "/marathon";
    navigate(`${route}?c=${code}`);
  }

  return (
    <div className="min-h-screen">
      <LeafBackground density={20} />
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-8">
        <TopBar />

        <div className="flex flex-1 flex-col gap-6 py-6">
          <div>
            <Link
              to="/"
              className="font-mono text-[11px] uppercase tracking-widest text-clade-ink/40 transition hover:text-clade-ink"
            >
              ← Games
            </Link>
            <h1 className="mt-1 font-hand text-5xl font-bold text-clade-ink">
              {game?.label ?? "Set up"}
            </h1>
            <p className="font-hand text-xl text-clade-ink/70">Set up your run, then play.</p>
          </div>

          {/* Left: packs, then difficulty + modifiers. Right: the big settings panel (only when
              the mode has gameplay dials). */}
          <div
            className={`grid items-start gap-5 ${
              hasSettings ? "md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]" : "md:grid-cols-1"
            }`}
          >
            <div className="flex flex-col gap-5">
              {/* Opponent — for games that are one game with several ways to play (Clade Clash).
                  This is a lobby choice, NOT a separate mode: it decides where Start sends you. */}
              {opponents.length > 0 && (
                <Panel title="Opponent">
                  <div className="flex flex-wrap gap-2">
                    {opponents.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => pickOpponent(o)}
                        className={`pill ${opponent?.value === o.value ? "pill-active" : "border-dashed"}`}
                      >
                        {o.label}
                        <span className="ml-1.5 font-mono text-[10px] opacity-70">{o.hint}</span>
                      </button>
                    ))}
                  </div>
                  {opponent?.value === "player" && cfg.scopes.length > 1 && (
                    <p className="mt-2 font-mono text-[11px] text-clade-ink/45">
                      A duel pairs players on the same packs — your opponent needs this exact
                      mix, so a set is the quickest thing to agree on.
                    </p>
                  )}
                </Panel>
              )}

              {/* Packs */}
              <Panel title="Packs">
                <ScopePicker
                  scopes={scopes}
                  value={cfg.scopes}
                  onChange={(keys) => setCfg((c) => ({ ...c, scopes: [...keys].sort() }))}
                />
                {/* Sets (#120): one-click presets that select a curated bundle of packs. A set
                    is "active" when the selection matches its members exactly. */}
                {sets.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">
                      sets
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {sets.map((s) => {
                        const active = sameScopes(cfg.scopes, s.scopes);
                        return (
                          <button
                            key={s.key}
                            type="button"
                            onClick={() => setCfg((c) => ({ ...c, scopes: [...s.scopes].sort() }))}
                            title={`${s.blurb ? s.blurb + " · " : ""}${s.pack_count} packs · ${s.tip_count.toLocaleString()} species`}
                            className={`pill ${active ? "pill-active" : "border-dashed"}`}
                          >
                            {s.label}{" "}
                            <span className="font-mono text-[11px] opacity-60">{s.pack_count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <p className="mt-2 font-mono text-[11px] text-clade-ink/45">
                  {scopes.length === 0
                    ? "No packs available — seed one (see docs)."
                    : cfg.scopes.length > 1
                      ? `mixing ${cfg.scopes.length} · ${totalTips.toLocaleString()} species`
                      : `${totalTips.toLocaleString()} species`}
                </p>
                {/* Each pack downloads its own blob, so loading time grows with the count (#120). */}
                {cfg.scopes.length >= 3 && (
                  <p className="mt-1 font-mono text-[11px] text-amber-700/80">
                    ⚠ {cfg.scopes.length} packs — loading can take up to ~10s.
                  </p>
                )}
              </Panel>

              {/* Difficulty (the lens) */}
              {supportsDifficulty && (
                <Panel title="Difficulty">
                  <div className="flex gap-2">
                    <DiffPill active={cfg.difficulty === "common"} onClick={() => setDiff(setCfg, "common")}>
                      Common
                    </DiffPill>
                    <DiffPill
                      active={cfg.difficulty === "scientific"}
                      onClick={() => setDiff(setCfg, "scientific")}
                    >
                      Scientific
                    </DiffPill>
                  </div>
                </Panel>
              )}

              {/* Modifiers — opt-in mutators, each carrying a score multiplier (#101). */}
              {modInfo && modInfo.modifiers.length > 0 && (
                <Panel title="Modifiers">
                  <div className="flex flex-wrap gap-2">
                    {modInfo.modifiers.map((m) => {
                      const on = cfg.modifiers.includes(m.key);
                      // Grey out a modifier incompatible with the current selection (unless it's
                      // the one already on, so it can be toggled off).
                      const blocked =
                        !on && (m.incompatible_with ?? []).some((k) => cfg.modifiers.includes(k));
                      return (
                        <button
                          key={m.key}
                          type="button"
                          disabled={blocked}
                          onClick={() => toggleModifier(m.key)}
                          title={m.blurb || undefined}
                          className={`pill ${on ? "pill-active" : "border-dashed"} ${
                            blocked ? "cursor-not-allowed opacity-40" : ""
                          } ${conflicts.has(m.key) ? "!border-red-500" : ""}`}
                        >
                          {m.label}
                          <span className="ml-1.5 font-mono text-[10px] opacity-70">
                            {formatMultiplier(m.multiplier)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Panel>
              )}
            </div>

            {/* Right: settings (the big panel) — only for modes that have gameplay dials. */}
            {hasSettings && (
            <div className="ink-card flex h-full flex-col gap-5 bg-clade-paper p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-baseline gap-3">
                  <h2 className="font-hand text-2xl font-bold text-clade-ink">Settings</h2>
                  {!atDefaults && (
                    <button
                      type="button"
                      onClick={() => setCfg((c) => ({ ...c, settings: { ...gameDefaults() } }))}
                      className="font-mono text-[11px] uppercase tracking-wide text-clade-ink/45 underline-offset-2 transition hover:text-clade-ink hover:underline"
                    >
                      ↺ Reset
                    </button>
                  )}
                </div>
                {/* Only for games that actually score. A game with no modifiers has no way to
                    move its multiplier off 1×, so the badge would just assert "1× run" at a
                    player — actively misleading on Clade Clash, which isn't scored at all. */}
                {modInfo && modInfo.modifiers.length > 0 && (
                  <span
                    className={`font-mono text-[11px] uppercase tracking-wide ${
                      multiplier === 1
                        ? "text-clade-ink/45"
                        : multiplier > 1
                          ? "text-clade-accent"
                          : "text-clade-ink/55"
                    }`}
                    title="Score multiplier from your modifiers + settings"
                  >
                    ● {formatMultiplier(multiplier)} run
                  </span>
                )}
              </div>
              <SettingsFields
                fields={fields}
                settings={shownSettings}
                locked={lockedKeys}
                onChange={(next) =>
                  setCfg((c) => {
                    // Don't bake the forced overlay into the stored config — keep the player's
                    // own value for locked keys, so removing the modifier restores it.
                    const merged = { ...next } as unknown as Record<string, unknown>;
                    const own = c.settings as unknown as Record<string, unknown>;
                    for (const k of lockedKeys) merged[k] = own[k];
                    return { ...c, settings: merged as unknown as GameSettings };
                  })
                }
              />
            </div>
            )}
          </div>

          <button type="button" onClick={start} className="btn-play self-start text-2xl">
            ▶ Play
          </button>
        </div>
      </div>
    </div>
  );
}

/** A titled field-notebook card — the lobby's left-column sections. */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ink-card bg-clade-paper p-5">
      <h2 className="mb-3 font-hand text-2xl font-bold text-clade-ink">{title}</h2>
      {children}
    </div>
  );
}

/** Seed the lobby's config from the last-used one for this game, else defaults. */
function seedConfig(mode: string): GameConfig {
  try {
    const code = localStorage.getItem(configKey(mode));
    if (code) {
      const c = decodeConfig(code);
      if (c && c.mode === mode) return c;
    }
  } catch {
    /* ignore corrupt/unavailable storage */
  }
  return defaultConfig(mode);
}

function setDiff(
  setCfg: React.Dispatch<React.SetStateAction<GameConfig>>,
  d: Difficulty,
) {
  setCfg((c) => ({ ...c, difficulty: d }));
}

function DiffPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={`pill ${active ? "pill-active" : "border-dashed"}`}>
      {children}
    </button>
  );
}
