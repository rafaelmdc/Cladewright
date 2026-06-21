// Sign-in page — the leaf-backdrop site chrome + a provider card. Google is the only
// method at launch; the card is a stack so more providers (email, GitHub…) slot in later.
// "Continue with Google" both signs in and, on first visit, creates the account.

import { Link } from "react-router-dom";

import { LeafMark } from "../components/Brand";
import { LeafBackground } from "../components/LeafBackground";
import { GOOGLE_LOGIN_URL } from "../lib/auth";
import { useTitle } from "../lib/useTitle";

export function Login() {
  useTitle("Sign in");
  return (
    <div className="relative grid min-h-screen place-items-center px-4">
      <LeafBackground density={24} />

      <Link
        to="/"
        className="absolute left-6 top-6 font-mono text-xs uppercase tracking-widest text-clade-ink/50 hover:text-clade-ink"
      >
        ← back
      </Link>

      <div className="ink-card w-full max-w-sm bg-clade-paper px-7 py-9 text-center">
        <LeafMark className="mx-auto h-10 w-10 text-clade-accent" />
        <h1 className="mt-3 font-hand text-5xl font-bold text-clade-ink">Sign in</h1>
        <p className="mt-1 font-mono text-xs text-clade-ink/50">
          to save runs and climb the leaderboard
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <ProviderButton href={GOOGLE_LOGIN_URL} icon={<GoogleIcon />}>
            Continue with Google
          </ProviderButton>
          {/* More providers go here later (email, GitHub…). */}
        </div>

        <p className="mt-5 font-mono text-[11px] leading-relaxed text-clade-ink/40">
          New here? Continuing with Google creates your account automatically.
        </p>
      </div>
    </div>
  );
}

function ProviderButton({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="flex items-center justify-center gap-3 rounded-2xl border-2 border-clade-ink/80 bg-clade-paper px-4 py-2.5 font-hand text-2xl text-clade-ink shadow-sm transition hover:border-clade-accent hover:bg-clade-accentSoft/40"
    >
      {icon}
      {children}
    </a>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 24 44c11 0 19.5-8 19.5-20 0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C39.9 36 43.5 30.6 43.5 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}
