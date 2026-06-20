/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Museum-like, calm palette — see docs/examples for the intended look.
      // TODO(phase-2): commit a real type scale + palette via frontend-design.
      colors: {
        clade: {
          bg: "#ece9e1",
          ink: "#2b2b28",
          accent: "#3f6b4c",
        },
      },
    },
  },
  plugins: [],
};
