// Share controls for a finished run (#74): copy a public link to the result page, save the
// result as an image, or hand it to the native share sheet (mobile). Used on the game-over
// card and the standalone /r/:id result page. All client-side; the image is drawn on a
// canvas (see lib/shareImage).

import { useState } from "react";

import { shareUrlFor, type ShareData } from "../lib/share";
import { canShareImage, downloadBlob, renderResultImage, shareImage } from "../lib/shareImage";

export function ShareResult({ result }: { result: ShareData }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const shareUrl = shareUrlFor(result);
  const shareText = `I named ${result.animals} animals for ${result.score} points on Cladewright — ${result.scope}.`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the link is still visible on the result page */
    }
  }

  async function onImage(share: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await renderResultImage(result, shareUrl);
      if (!blob) return;
      if (share && canShareImage(blob)) {
        await shareImage(blob, shareText, shareUrl);
      } else {
        downloadBlob(blob, `cladewright-${result.score}.png`);
      }
    } catch {
      /* user dismissed the share sheet, or rendering failed — nothing to do */
    } finally {
      setBusy(false);
    }
  }

  const nativeShare = typeof navigator.share === "function";

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button onClick={copyLink} className={pill}>
        {copied ? "Link copied ✓" : "Copy link"}
      </button>
      <button onClick={() => onImage(false)} disabled={busy} className={pill}>
        {busy ? "…" : "Save image"}
      </button>
      {nativeShare && (
        <button onClick={() => onImage(true)} disabled={busy} className={pill}>
          Share
        </button>
      )}
    </div>
  );
}

const pill =
  "rounded-full border-2 border-clade-ink/25 px-4 py-1.5 font-mono text-xs uppercase tracking-widest text-clade-ink/65 transition hover:border-clade-accent hover:text-clade-ink disabled:opacity-50";
