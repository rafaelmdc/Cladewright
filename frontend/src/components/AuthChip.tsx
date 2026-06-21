// Tiny auth affordance for the top nav: signed-in username (links to the account page)
// or a "Sign in" link that kicks off the Google flow.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { fetchMe, GOOGLE_LOGIN_URL, type Me } from "../lib/auth";

export function AuthChip() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetchMe().then(setMe);
  }, []);

  if (me === null) return null; // unknown yet — don't flash
  if (!me.authenticated) {
    return (
      <a href={GOOGLE_LOGIN_URL} className="pill">
        Sign in
      </a>
    );
  }
  return (
    <Link to="/account" className="pill pill-active" title="Account">
      {me.username}
    </Link>
  );
}
