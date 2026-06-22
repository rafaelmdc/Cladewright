// One-time, non-invasive card shown after account creation: the account starts with an
// auto-generated internal handle, so we invite the user to set a real display name. It
// appears only while `name_chosen` is false, can be skipped (you can always change it later
// in the profile), and won't re-nag within the same browser session once dismissed.
// See GitHub issue #62.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { fetchMe } from "../lib/auth";
import { DisplayNameField } from "./DisplayNameField";

const SKIP_KEY = "cw.displayNamePrompt.skipped";

export function DisplayNamePrompt() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");

  useEffect(() => {
    if (sessionStorage.getItem(SKIP_KEY)) return;
    fetchMe().then((me) => {
      if (me.authenticated && me.name_chosen === false) {
        setCurrent(me.display_name ?? "");
        setOpen(true);
      }
    });
  }, []);

  function dismiss() {
    sessionStorage.setItem(SKIP_KEY, "1");
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-clade-ink/30 px-4 backdrop-blur-sm">
      <div className="ink-card w-full max-w-md bg-clade-paper px-6 py-6">
        <h2 className="font-hand text-3xl font-bold text-clade-ink">Pick a display name</h2>
        <p className="mt-1 font-mono text-xs text-clade-ink/55">
          You're signed in as{" "}
          <span className="text-clade-ink/80">{current || "a new naturalist"}</span>. Choose
          how you'd like to appear on leaderboards and your profile.
        </p>
        <div className="mt-4">
          <DisplayNameField
            initial={current}
            autoFocus
            saveLabel="Set name"
            onSaved={() => {
              sessionStorage.setItem(SKIP_KEY, "1");
              setOpen(false);
            }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button
            onClick={dismiss}
            className="font-mono text-xs uppercase tracking-widest text-clade-ink/45 hover:text-clade-ink"
          >
            Maybe later
          </button>
          <Link
            to="/account"
            onClick={dismiss}
            className="font-mono text-[11px] text-clade-ink/45 hover:text-clade-ink"
          >
            change any time in your profile →
          </Link>
        </div>
      </div>
    </div>
  );
}
