/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Field-notebook aesthetic — see docs/examples for the intended look:
      // warm cream paper, near-black ink, forest-green accent, sticky-note yellow.
      colors: {
        clade: {
          bg: "#ece7db", // paper
          paper: "#f5f1e8", // lighter card surface
          ink: "#262219", // warm near-black
          accent: "#3f6b4c", // forest green
          accentSoft: "#cdd8cb",
          note: "#f1e7c4", // sticky-note yellow
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
