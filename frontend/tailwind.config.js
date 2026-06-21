/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Field-notebook aesthetic. The actual values live as CSS variables in index.css
      // (space-separated RGB channels) so they can be re-themed at runtime via
      // <html data-theme>; `<alpha-value>` keeps Tailwind's /opacity modifiers working.
      // See src/lib/theme.ts for the available themes.
      colors: {
        clade: {
          bg: "rgb(var(--clade-bg) / <alpha-value>)",
          paper: "rgb(var(--clade-paper) / <alpha-value>)",
          ink: "rgb(var(--clade-ink) / <alpha-value>)",
          accent: "rgb(var(--clade-accent) / <alpha-value>)",
          accentSoft: "rgb(var(--clade-accentSoft) / <alpha-value>)",
          note: "rgb(var(--clade-note) / <alpha-value>)",
        },
      },
      fontFamily: {
        // `font-hand` headings/labels, `font-mono` captions/nav, `font-sans` long reads.
        hand: ['"Caveat"', "ui-rounded", "cursive"],
        mono: ['"Space Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
