// Theme is a stamp on <html>, read by the [data-theme="dark"] blocks in
// index.css, Navigation.css and MaxeMark. Nothing else needs to know it exists:
// screens that style from the token aliases follow automatically.
//
// Applied before React mounts (see main.tsx) so a dark user never sees a light
// frame flash first.

export type Theme = 'light' | 'dark';

const KEY = 'exammind-theme';

function safe<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

export function getTheme(): Theme {
  return safe(() => (window.localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'), 'light');
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
}

export function setTheme(theme: Theme): void {
  safe(() => window.localStorage.setItem(KEY, theme), undefined);
  applyTheme(theme);
}

export function initTheme(): void {
  applyTheme(getTheme());
}
