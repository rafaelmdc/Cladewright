import { useEffect } from "react";

// Per-page browser-tab title: "Cladewright" on the hub, "Cladewright - X" elsewhere.
export function useTitle(suffix?: string) {
  useEffect(() => {
    document.title = suffix ? `Cladewright - ${suffix}` : "Cladewright";
    return () => {
      document.title = "Cladewright";
    };
  }, [suffix]);
}
