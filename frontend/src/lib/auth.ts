// Auth client for the SPA. Login is allauth's Google flow — a top-level redirect to
// /accounts/google/login/ (proxied to Django in dev), which sets a session cookie and
// bounces back. These helpers just read the session ("who am I?"), read the CSRF token
// for authenticated POSTs, and log out.

export interface Me {
  authenticated: boolean;
  username?: string;
  email?: string;
}

/** Top-level navigation target for "Sign in with Google". */
export const GOOGLE_LOGIN_URL = "/accounts/google/login/";

/** Current session. Also causes Django to set the csrftoken cookie (ensure_csrf_cookie). */
export async function fetchMe(): Promise<Me> {
  try {
    const res = await fetch("/api/auth/me/", { credentials: "include" });
    if (!res.ok) return { authenticated: false };
    return (await res.json()) as Me;
  } catch {
    return { authenticated: false };
  }
}

/** Django's CSRF token from its cookie, for the X-CSRFToken header on unsafe requests. */
export function csrfToken(): string {
  return document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] ?? "";
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout/", {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRFToken": csrfToken() },
    });
  } catch {
    /* ignore */
  }
}
