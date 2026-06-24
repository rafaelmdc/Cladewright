// Renders a run's result as a shareable image (#74) — a field-notebook result card drawn on
// a canvas, so a player can save or share their score anywhere. Theme-aware (reads the live
// --clade-* CSS vars) and uses the brand fonts once they've loaded. No deps; returns a Blob.

import type { ShareData } from "./share";

const W = 1200;
const H = 630;

/** An `rgb(...)` string from a `--clade-*` CSS variable ("245 241 232" → "rgb(245 241 232)"). */
function cssColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `rgb(${v})` : fallback;
}

/** Draw the result card onto a canvas and return it as a PNG blob. */
export async function renderResultImage(result: ShareData, shareUrl: string): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Best-effort: wait for the webfonts so the card isn't drawn in a fallback face.
  try {
    await Promise.all([document.fonts.load('700 100px "Caveat"'), document.fonts.load('400 40px "Space Mono"')]);
  } catch {
    /* fonts will just fall back */
  }

  const paper = cssColor("--clade-paper", "rgb(245 241 232)");
  const ink = cssColor("--clade-ink", "rgb(38 34 25)");
  const accent = cssColor("--clade-accent", "rgb(63 107 76)");

  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);
  // Inked border, field-notebook style.
  ctx.strokeStyle = ink;
  ctx.lineWidth = 6;
  ctx.strokeRect(28, 28, W - 56, H - 56);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  const cx = W / 2;
  ctx.textAlign = "center";

  // Wordmark
  ctx.fillStyle = accent;
  ctx.font = '700 64px "Caveat", cursive';
  ctx.fillText("Cladewright", cx, 130);

  // Big score
  ctx.fillStyle = ink;
  ctx.font = '700 220px "Caveat", cursive';
  ctx.fillText(String(result.score), cx, 360);
  ctx.fillStyle = accent;
  ctx.font = '700 44px "Caveat", cursive';
  ctx.fillText("points", cx, 410);

  // Sub-line: animals named + scope + difficulty
  ctx.fillStyle = ink;
  ctx.font = '700 52px "Caveat", cursive';
  const diff = result.difficulty === "scientific" ? "scientific" : "common";
  ctx.fillText(`${result.animals} animals named · ${result.scope} · ${diff}`, cx, 480);

  // Rank badge (ranked runs only)
  if (result.rank != null) {
    ctx.fillStyle = accent;
    ctx.font = '700 60px "Caveat", cursive';
    ctx.fillText(`rank #${result.rank}`, cx, 545);
  }

  // Footer URL
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.5;
  ctx.font = '400 26px "Space Mono", monospace';
  ctx.fillText(shareUrl.replace(/^https?:\/\//, ""), cx, H - 60);
  ctx.globalAlpha = 1;

  return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Trigger a download of a blob as `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** True when the browser can share image FILES (mobile Safari/Chrome, mostly). */
export function canShareImage(blob: Blob): boolean {
  const file = new File([blob], "result.png", { type: "image/png" });
  return typeof navigator.share === "function" && !!navigator.canShare?.({ files: [file] });
}

/** Open the native share sheet with the image + link (where supported). */
export async function shareImage(blob: Blob, text: string, url: string): Promise<void> {
  const file = new File([blob], "cladewright-result.png", { type: "image/png" });
  await navigator.share({ files: [file], text, url });
}
