import type { ThemeColor, ThemeFont, ThemeView } from '@hot-mic/shared';

const FONTS: Record<ThemeFont, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  rounded: "ui-rounded, 'Hiragino Maru Gothic ProN', 'Arial Rounded MT Bold', system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  display: "Impact, 'Arial Black', Haettenschweiler, sans-serif",
  handwriting: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive",
};

/** The CSS variable each color token sets. */
const VARS: Record<ThemeColor, string> = {
  bg: '--bg',
  panel: '--panel',
  panel2: '--panel-2',
  text: '--text',
  muted: '--muted',
  primary: '--primary',
  accent: '--accent',
  good: '--good',
  bad: '--bad',
};

let current: ThemeView | null = null;

/** The sounds the picked theme replaces cues with, as URLs. */
export const themeSounds = (): ThemeView['sounds'] => current?.sounds ?? {};

/** Puts a theme's tokens on the page as CSS variables; null puts the plain look back. */
export function applyTheme(theme: ThemeView | null) {
  if (theme?.id === current?.id && JSON.stringify(theme) === JSON.stringify(current)) return;
  current = theme;
  const style = document.documentElement.style;
  for (const [token, name] of Object.entries(VARS)) {
    const value = theme?.colors[token as ThemeColor];
    if (value) style.setProperty(name, value);
    else style.removeProperty(name);
  }
  if (theme && theme.font !== 'system') style.setProperty('--font', FONTS[theme.font]);
  else style.removeProperty('--font');
  if (theme?.background) style.setProperty('--bg-image', `url("${theme.background}")`);
  else style.removeProperty('--bg-image');
}
