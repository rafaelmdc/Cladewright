import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API + the allauth OAuth routes to Django so the SPA — and the Google login
    // redirect round-trip — are all same-origin (localhost:5173). changeOrigin:false
    // PRESERVES the Host header (localhost:5173), so Django builds the OAuth callback +
    // post-login redirect on :5173 too — the whole flow stays first-party, cookies and
    // all, instead of bouncing the user to the bare Django port.
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: false },
      "/accounts": { target: "http://localhost:8000", changeOrigin: false },
    },
  },
});
