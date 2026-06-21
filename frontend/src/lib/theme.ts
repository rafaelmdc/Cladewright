// Theme switching. Each theme is just a set of CSS variables (see index.css); we flip
// between them by setting <html data-theme>. Persisted to localStorage and applied before
// first paint by a tiny inline script in index.html (so there's no flash of the wrong theme).

export const THEMES = ["notebook", "contrast", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  notebook: "Notebook",
  contrast: "High contrast",
  dark: "Dark",
};

const KEY = "cladewright.theme";

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t && (THEMES as readonly string[]).includes(t)) return t as Theme;
  } catch {
    /* storage unavailable */
  }
  return "notebook";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable — the attribute still applies for this session */
  }
}
