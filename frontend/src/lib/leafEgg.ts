// Secret "spooked leaves" easter egg: press and HOLD the leaf logo for 5 seconds and the
// background leaves start fleeing your cursor instead of waiting to be grabbed. Hold again to
// calm them. Off by default and remembered across visits — a quick click on the logo is
// untouched (it still navigates home), so normal users never trip this.

import { useEffect, useState } from "react";

const KEY = "cladewright.leafFlee";
const EVT = "cw:leafflee";

/** How long the logo must be held to flip the egg. */
export const LEAF_HOLD_MS = 5000;

export function leafFleeOn(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setLeafFlee(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: on }));
}

/** Flip the egg; returns the new state. */
export function toggleLeafFlee(): boolean {
  const next = !leafFleeOn();
  setLeafFlee(next);
  return next;
}

/** Subscribe to the flee flag (updates live when it's toggled anywhere). */
export function useLeafFlee(): boolean {
  const [on, setOn] = useState(leafFleeOn);
  useEffect(() => {
    const h = (e: Event) => setOn(!!(e as CustomEvent).detail);
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  }, []);
  return on;
}
