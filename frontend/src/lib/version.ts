// Build version surfacing. The frontend version is baked at build time (Vite inlines
// VITE_APP_VERSION — see frontend/Dockerfile); the API version is fetched from the backend.
// Showing both in the footer makes "did my deploy land?" answerable at a glance — and a
// mismatch flags the classic half-deploy (frontend rolled, web pod didn't, or vice-versa).

export const FRONTEND_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "dev";
export const FRONTEND_BUILT: string = import.meta.env.VITE_APP_BUILT ?? "";

/** The running backend build, or null if unreachable. */
export async function fetchApiVersion(): Promise<string | null> {
  try {
    const res = await fetch("/api/version/");
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}
