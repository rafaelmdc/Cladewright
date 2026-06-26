// Shared setting-control primitives + a schema-driven renderer. Extracted from SettingsPanel
// (#96) so the lobby and the in-game gear render the SAME controls from the per-game schema
// (lib/game/schema.ts) instead of each hardcoding them. See docs/lobby-and-config.md.

import type { GameSettings } from "../../lib/game/settings";
import type { SettingField } from "../../lib/game/schema";

/** Render a list of schema fields against a settings object, grouped by `field.group`.
 *  `locked` keys (e.g. settings a modifier forces) render disabled — shown but not editable. */
export function SettingsFields({
  fields,
  settings,
  onChange,
  locked,
}: {
  fields: SettingField[];
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
  locked?: Set<keyof GameSettings>;
}) {
  // Preserve first-seen group order from the schema.
  const groups: string[] = [];
  for (const f of fields) if (!groups.includes(f.group)) groups.push(f.group);

  return (
    <>
      {groups.map((group, gi) => (
        <div key={group} className={gi > 0 ? "border-t border-clade-ink/10 pt-4" : ""}>
          <p className="mb-3 text-xs uppercase tracking-wide text-clade-ink/40">{group}</p>
          {fields
            .filter((f) => f.group === group)
            .map((f) => (
              <FieldControl
                key={f.key}
                field={f}
                settings={settings}
                onChange={onChange}
                locked={locked?.has(f.key) ?? false}
              />
            ))}
        </div>
      ))}
    </>
  );
}

function FieldControl({
  field,
  settings,
  onChange,
  locked = false,
}: {
  field: SettingField;
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
  locked?: boolean;
}) {
  // Locked (a modifier forces this setting) or conditionally disabled (e.g. time dials under
  // infinite time) — either way the control is shown but inert.
  const disabled = locked || (field.disabledWhen?.(settings) ?? false);
  const set = (value: GameSettings[keyof GameSettings]) =>
    disabled ? undefined : onChange({ ...settings, [field.key]: value });
  const value = settings[field.key];

  switch (field.kind) {
    case "toggle":
      return (
        <div className="mt-4 first:mt-0">
          <Toggle
            label={field.label}
            hint={field.hint}
            checked={value as boolean}
            disabled={disabled}
            onChange={(v) => set(v)}
          />
        </div>
      );
    case "slider":
      return (
        <Slider
          label={field.label}
          hint={field.hint}
          unit={field.unit}
          min={field.min ?? 0}
          max={field.max ?? 100}
          step={field.step ?? 1}
          value={value as number}
          disabled={disabled}
          onChange={(v) => set(v)}
        />
      );
    case "segmented":
      return (
        <div className="mt-1">
          <Segmented
            label={field.label}
            value={value as string}
            options={field.options ?? []}
            disabled={disabled}
            onChange={(v) => set(v as GameSettings[keyof GameSettings])}
          />
        </div>
      );
  }
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className={disabled ? "opacity-40" : ""}>
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1.5 flex rounded-lg border border-clade-ink/15 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
              value === o.value ? "bg-clade-accent text-white" : "text-clade-ink/60 hover:text-clade-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`flex items-start justify-between gap-3 ${disabled ? "opacity-40" : "cursor-pointer"}`}>
      <span>
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-clade-ink/45">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
          checked ? "bg-clade-accent" : "bg-clade-ink/20"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </label>
  );
}

export function Slider({
  label,
  hint,
  unit,
  min,
  max,
  step,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className={`mb-4 ${disabled ? "opacity-40" : ""}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-sm text-clade-ink/60">
          {value}
          {unit}
        </span>
      </div>
      {hint && <span className="block text-xs text-clade-ink/45">{hint}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-clade-accent"
      />
    </div>
  );
}
