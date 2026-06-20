# accounts

Identity for Cladewright. Phase 4.

Google OAuth via **django-allauth** (`allauth.socialaccount.providers.google`,
already in `INSTALLED_APPS`). To finish:

- Register a Google OAuth client; add a `SocialApp` (client id/secret) — via env +
  a data migration or the admin, never hard-coded.
- Decide session vs token auth for the SPA. The SPA is same-site in the simple
  deploy, so session auth + CSRF is the low-friction default; switch to tokens only
  if the frontend is served from a different origin.
- Add a `GET /api/accounts/me/` endpoint so the SPA knows who is signed in.

No custom user model yet — start on `django.contrib.auth.User`; introduce a custom
model only if a real need appears (do it before first migrations if so).
