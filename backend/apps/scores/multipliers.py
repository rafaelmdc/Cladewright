"""
Server-side score-multiplier resolution (#101).

Every run lands on ONE board, ranked by ``final = base × multiplier``. The default setup is
exactly 1.0×. The multiplier is the product of:

  * **modifiers** — opt-in gameplay mutators (GameModifier rows), each declaring its own factor
    (a harder one >1.0, an easier one <1.0);
  * **setting derates** — score-EASING gameplay settings (infinite time, a longer clock) that
    used to hard-ban a run from the board now just multiply it down (≤1.0×).

The server re-derives this from the submitted config against its OWN definitions — a client
number is never trusted (same principle as the combo/clade re-score). Mirrored on the client
only for the lobby's live preview (frontend/src/lib/game/multipliers.ts); this module is the
authority.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Built-in default setting-derate ruleset for Marathon, used when a GameDefaults row carries no
# admin override (``setting_multipliers`` empty). Keys are the camelCase GameSettings names the
# client posts. Two rule shapes:
#   * bool   — when settings[key] == easing_value, multiply by `multiplier`.
#   * linear — multiplier = clamp(1 + per_unit·(value − default), floor, 1.0); only ever derates
#              (cap 1.0), so a harder-than-default dial gives no bonus (that's a modifier's job).
# Numbers are illustrative, admin-tunable starting points (see docs/lobby-and-config.md).
DEFAULT_SETTING_MULTIPLIERS: dict[str, dict] = {
    "infiniteTime": {"kind": "bool", "easing_value": True, "multiplier": 0.5},
    "startSeconds": {"kind": "linear", "default": 60, "per_unit": -0.0025, "floor": 0.5},
    "timePerNew": {"kind": "linear", "default": 10, "per_unit": -0.01, "floor": 0.6},
    "noveltyBonus": {"kind": "linear", "default": 8, "per_unit": -0.005, "floor": 0.7},
    "timePerRefinement": {"kind": "linear", "default": 5, "per_unit": -0.01, "floor": 0.8},
    "comboWindowSeconds": {"kind": "linear", "default": 6, "per_unit": -0.02, "floor": 0.8},
    "comboTimeMultiplier": {"kind": "linear", "default": 1.5, "per_unit": -0.05, "floor": 0.7},
}


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _setting_factor(rule: dict, value) -> float:
    """One setting's multiplier from its rule + the run's value. 1.0 (no effect) for an unknown
    rule kind or a non-numeric value where a number is expected, so a malformed rule can never
    *inflate* a score — it just doesn't derate."""
    kind = rule.get("kind")
    if kind == "bool":
        return float(rule.get("multiplier", 1.0)) if value == rule.get("easing_value") else 1.0
    if kind == "linear":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return 1.0
        base = float(rule.get("default", 0))
        per = float(rule.get("per_unit", 0))
        floor = float(rule.get("floor", 0))
        return _clamp(1.0 + per * (float(value) - base), floor, 1.0)
    return 1.0


@dataclass
class Resolution:
    """The resolved multiplier + an audit breakdown. ``error`` set (and multiplier left 1.0)
    means the config is invalid (e.g. incompatible modifiers) — the caller rejects the run."""

    multiplier: float = 1.0
    modifiers: list[str] = field(default_factory=list)  # the valid, known active modifier keys
    breakdown: dict[str, float] = field(default_factory=dict)  # label -> factor, for display/audit
    # The run's settings AFTER applying each active modifier's forced values — the authoritative
    # settings the run actually played under (the caller stores these + derives extant_only).
    settings: dict = field(default_factory=dict)
    error: str | None = None


def resolve_modifier_multiplier(active: list[str], mod_defs: dict[str, dict]) -> Resolution:
    """Resolve the product of the active modifiers against the game's enabled definitions.

    * Unknown / disabled keys are dropped (a client can't conjure a modifier the server doesn't
      serve).
    * An incompatible pair (per each modifier's ``incompatible_with``) is a hard error — the
      lobby greys these out, so a posted pair is a tampered/stale config.
    """
    res = Resolution()
    known = [k for k in dict.fromkeys(active) if k in mod_defs]  # dedupe, keep order, drop unknown
    chosen = set(known)
    for k in known:
        bad = chosen & set(mod_defs[k].get("incompatible_with") or [])
        if bad:
            res.error = f"incompatible modifiers: {k} + {sorted(bad)[0]}"
            return res
    for k in known:
        m = float(mod_defs[k].get("multiplier", 1.0))
        res.multiplier *= m
        res.breakdown[mod_defs[k].get("label", k)] = m
    res.modifiers = known
    return res


def resolve_settings_multiplier(settings: dict, rules: dict[str, dict]) -> dict[str, float]:
    """label/key -> derate for each score-easing setting that deviates. Only factors ≠ 1.0 are
    returned (a default setup contributes nothing)."""
    out: dict[str, float] = {}
    if not isinstance(settings, dict):
        return out
    for key, rule in (rules or {}).items():
        if key not in settings:
            continue
        f = _setting_factor(rule, settings[key])
        if f != 1.0:
            out[key] = f
    return out


def resolve_multiplier(
    *,
    modifiers: list[str],
    settings: dict,
    mod_defs: dict[str, dict],
    setting_rules: dict[str, dict],
) -> Resolution:
    """Full resolution: ∏ active-modifier factors × ∏ setting derates. ``error`` set → reject.

    A modifier may FORCE settings (``forces`` in its def); those are applied here, server-side,
    on top of the client's posted settings — so a modifier that eases the game (e.g. forces
    infinite time) still incurs that setting's derate even if the client omits it. The resulting
    effective settings ride back on ``Resolution.settings``."""
    res = resolve_modifier_multiplier(modifiers or [], mod_defs)
    if res.error:
        return res
    effective = dict(settings or {})
    for k in res.modifiers:
        forced = mod_defs[k].get("forces")
        if isinstance(forced, dict):
            effective.update(forced)
    res.settings = effective
    for key, f in resolve_settings_multiplier(effective, setting_rules).items():
        res.multiplier *= f
        res.breakdown[key] = f
    return res


def final_score(base: int, multiplier: float) -> int:
    """The board score: base × multiplier, rounded to an int (never negative)."""
    return max(0, round(base * multiplier))
