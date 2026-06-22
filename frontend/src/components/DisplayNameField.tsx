// Inline editor for the public display name. Used both in the account page (edit any time)
// and the post-sign-up prompt. Validation is server-authoritative; this just shows the
// message it returns. See GitHub issue #62.

import { useState } from "react";

import { updateDisplayName } from "../lib/auth";

export function DisplayNameField({
  initial,
  max = 24,
  autoFocus = false,
  saveLabel = "Save",
  onSaved,
}: {
  initial: string;
  max?: number;
  autoFocus?: boolean;
  saveLabel?: string;
  onSaved?: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const dirty = value.trim() !== initial.trim();

  async function save() {
    if (!dirty || status === "saving") return;
    setStatus("saving");
    setError("");
    const res = await updateDisplayName(value);
    if (res.ok) {
      setValue(res.display_name ?? value);
      setStatus("saved");
      onSaved?.(res.display_name ?? value.trim());
    } else {
      setError(res.error ?? "Could not save.");
      setStatus("error");
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          value={value}
          maxLength={max}
          autoFocus={autoFocus}
          onChange={(e) => {
            setValue(e.target.value);
            if (status !== "idle") setStatus("idle");
          }}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Your display name"
          className="min-w-0 flex-1 rounded-xl border-2 border-clade-ink/20 bg-clade-paper px-3 py-1.5 font-hand text-xl text-clade-ink outline-none transition focus:border-clade-accent"
        />
        <button
          onClick={save}
          disabled={!dirty || status === "saving"}
          className="shrink-0 rounded-full border-2 border-clade-ink/80 bg-clade-paper px-4 py-1.5 font-hand text-lg text-clade-ink transition hover:border-clade-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === "saving" ? "Saving…" : saveLabel}
        </button>
      </div>
      <p className="mt-1.5 min-h-[1rem] font-mono text-[11px]">
        {status === "error" ? (
          <span className="text-red-700">{error}</span>
        ) : status === "saved" ? (
          <span className="text-clade-accent">Saved ✓</span>
        ) : (
          <span className="text-clade-ink/40">
            Shown on leaderboards. {max} characters max; letters, numbers, spaces, - . ' _
          </span>
        )}
      </p>
    </div>
  );
}
