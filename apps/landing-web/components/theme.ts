// Theme state for the landing. Dark is the default. The choice lives on <html data-theme> and in
// localStorage ('porden-theme'). If storage is unavailable, the toggle still works for the session.
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'porden-theme';
export const THEME_EVENT = 'porden-theme-change';

// Browser chrome colours, one per theme. They match --bg in each theme block of landing.css.
export const THEME_COLORS: Record<Theme, string> = { dark: '#0c0c0e', light: '#ffffff' };

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

export function readTheme(): Theme {
  const current = document.documentElement.dataset.theme;
  return isTheme(current) ? current : 'dark';
}

export function syncThemeColor(theme: Theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  syncThemeColor(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or blocked storage: the choice only lasts for this session.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function subscribeTheme(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

// Runs in <head> before the first paint so a saved light choice never flashes dark.
export const themeInitScript = `(function(){var t='dark';try{var s=localStorage.getItem('${THEME_KEY}');if(s==='light'||s==='dark')t=s}catch(e){}var d=document.documentElement;d.setAttribute('data-theme',t);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='light'?'${THEME_COLORS.light}':'${THEME_COLORS.dark}')})();`;
