'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { MoonIcon, SunIcon } from './icons';
import { applyTheme, readTheme, subscribeTheme, syncThemeColor, type Theme } from './theme';

// An icon button in the bar, or an icon with text inside the phone menu. Both show the action
// they will take: in dark it offers light, in light it offers dark.
export function ThemeToggle({ variant }: { variant: 'bar' | 'menu' }) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, (): Theme => 'dark');
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} theme`;

  // Keep the browser chrome colour in step with a theme that was set before hydration.
  useEffect(() => {
    syncThemeColor(theme);
  }, [theme]);

  return (
    <button
      className={`theme-toggle theme-toggle--${variant}`}
      type="button"
      aria-label={variant === 'bar' ? label : undefined}
      onClick={() => applyTheme(next)}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      {variant === 'menu' ? <span>{label}</span> : null}
    </button>
  );
}
