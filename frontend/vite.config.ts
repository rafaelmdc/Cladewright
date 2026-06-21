import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API + the allauth OAuth routes to Django so the SPA — and the Google login
    // redirect round-trip — are all same-origin (localhost:5173). That keeps the session
    // + CSRF cookies first-party with no cross-origin cookie fuss in dev.
    proxy: {
      "/api": "http://localhost:8000",
      "/accounts": "http://localhost:8000",
    },
  },
});
