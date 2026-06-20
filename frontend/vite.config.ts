import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API to the Django backend in dev so the SPA can hit /api/* same-origin.
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
