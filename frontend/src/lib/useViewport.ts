import { useEffect, useState } from "react";

/** The height of the *visual* viewport in CSS px — the area actually visible, which shrinks
 *  when the mobile on-screen keyboard opens (unlike 100vh / 100dvh, which don't). Returns
 *  null where visualViewport is unavailable (older browsers), so callers fall back to a CSS
 *  height. Sizing the play surface to this keeps the tree + docked input above the keyboard
 *  instead of drawn behind it (#133). */
export function useVisualViewportHeight(): number | null {
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setH(vv.height);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return h;
}

/** Whether the viewport is narrower than Tailwind's `sm` breakpoint (640px) — i.e. phone-ish.
 *  Drives the mobile play layout (bottom-docked input, shorter placeholder). */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 639px)").matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}
