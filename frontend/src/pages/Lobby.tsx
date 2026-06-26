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
import { fetchGames, FALLBACK_GAMES, type Game } from "../lib/games";
import {
  decodeConfig,
  defaultConfig,
  encodeConfig,
  type GameConfig,
} from "../lib/game/config";
import { gameplayFields } from "../lib/game/schema";
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

export function Lobby() {
  const { mode = "marathon_free" } = useParams();
  const navigate = useNavigate();
  const [games, setGames] = useState<Game[]>(FALLBACK_GAMES);
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
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
  }, []);

  const supportsDifficulty = game?.supports_difficulty ?? true;
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
  const shownSettings = { ...cfg.settings, ...effects.forced };
  const lockedKeys = new Set(Object.keys(effects.forced) as (keyof GameSettings)[]);
  // Live score multiplier the run will score at (∏ active modifiers × ∏ eased settings, #101).
  const multiplier = modInfo ? previewMultiplier(cfg.modifiers, cfg.settings, modInfo) : 1;
  const conflicts = modInfo ? conflictingModifiers(cfg.modifiers, modInfo.modifiers) : new Set<string>();

  function toggleModifier(key: string) {
    setCfg((c) => {
      const has = c.modifiers.includes(key);
      const next = has ? c.modifiers.filter((k) => k !== key) : [...c.modifiers, key];
      return { ...c, modifiers: next.sort() };
    });
  }

  function start() {
    const code = encodeConfig(cfg);
    try {
      localStorage.setItem(configKey(mode), code);
    } catch {
      /* storage unavailable — the run still launches, the lobby just won't pre-fill next time */
    }
    const route = game?.route ?? "/marathon";
    navigate(`${route}?c=${code}`);
  }

  return (
    <div className="min-h-screen">
      <LeafBackground density={20} />
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-8">
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

          {/* Packs */}
          <Section label="Packs">
            <div className="flex items-center gap-3">
              <ScopePicker
                scopes={scopes}
                value={cfg.scopes}
                onChange={(keys) => setCfg((c) => ({ ...c, scopes: [...keys].sort() }))}
              />
              <span className="font-mono text-[11px] text-clade-ink/45">
                {cfg.scopes.length > 1
                  ? `mixing ${cfg.scopes.length} · ${totalTips.toLocaleString()} species`
                  : `${totalTips.toLocaleString()} species`}
              </span>
            </div>
          </Section>

          {/* Difficulty (the lens) */}
          {supportsDifficulty && (
            <Section label="Difficulty">
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
            </Section>
          )}

          {/* Modifiers — opt-in mutators, each carrying a score multiplier (#101). */}
          {modInfo && modInfo.modifiers.length > 0 && (
            <Section label="Modifiers">
              <div className="flex flex-wrap gap-2">
                {modInfo.modifiers.map((m) => {
                  const on = cfg.modifiers.includes(m.key);
                  // Grey out a modifier incompatible with the current selection (unless it's the
                  // one already on, so it can be toggled off).
                  const blocked =
                    !on &&
                    (m.incompatible_with ?? []).some((k) => cfg.modifiers.includes(k));
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
            </Section>
          )}

          {/* Settings */}
          <div className="ink-card flex flex-col gap-5 bg-clade-paper p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-hand text-2xl font-bold text-clade-ink">Settings</h2>
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
            </div>
            <SettingsFields
              fields={fields}
              settings={shownSettings}
              locked={lockedKeys}
              onChange={(next) =>
                setCfg((c) => {
                  // Don't bake the forced overlay into the stored config — keep the player's own
                  // value for locked keys, so removing the modifier restores it.
                  const merged = { ...next } as unknown as Record<string, unknown>;
                  const own = c.settings as unknown as Record<string, unknown>;
                  for (const k of lockedKeys) merged[k] = own[k];
                  return { ...c, settings: merged as unknown as GameSettings };
                })
              }
            />
          </div>

          <button type="button" onClick={start} className="btn-play self-start text-2xl">
            ▶ Play
          </button>
        </div>
      </div>
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] uppercase tracking-wider text-clade-ink/45">{label}</span>
      {children}
    </div>
  );
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
