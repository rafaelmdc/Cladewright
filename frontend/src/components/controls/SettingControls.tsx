// Shared setting-control primitives + a schema-driven renderer. Extracted from SettingsPanel
// (#96) so the lobby and the in-game gear render the SAME controls from the per-game schema
// (lib/game/schema.ts) instead of each hardcoding them. See docs/lobby-and-config.md.

import type { GameSettings } from "../../lib/game/settings";
import type { SettingField } from "../../lib/game/schema";

/** Render a list of schema fields against a settings object, grouped by `field.group`. */
export function SettingsFields({
  fields,
  settings,
  onChange,
}: {
  fields: SettingField[];
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
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
              <FieldControl key={f.key} field={f} settings={settings} onChange={onChange} />
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
}: {
  field: SettingField;
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
}) {
  const set = (value: GameSettings[keyof GameSettings]) =>
    onChange({ ...settings, [field.key]: value });
  const disabled = field.disabledWhen?.(settings) ?? false;
  const value = settings[field.key];

  switch (field.kind) {
    case "toggle":
      return (
        <div className="mt-4 first:mt-0">
          <Toggle
            label={field.label}
            hint={field.hint}
            checked={value as boolean}
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
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1.5 flex rounded-lg border border-clade-ink/15 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
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
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span>
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-clade-ink/45">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
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
