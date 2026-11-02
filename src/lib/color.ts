// Цветовая математика для пользовательской темы (перенесена из старой версии QA Flow).

export interface CustomTheme {
  bg: string;
  panel: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
}

/** Исходные цвета тёмной темы: с них начинается пользовательская. */
export const DEFAULT_CUSTOM_THEME: CustomTheme = {
  bg: '#11121b',
  panel: '#1b1d2a',
  border: '#35374d',
  text: '#f1f0fa',
  muted: '#999db6',
  accent: '#b9a5ff',
};

export const THEME_FIELDS: { key: keyof CustomTheme; label: string }[] = [
  { key: 'bg', label: 'Фон' },
  { key: 'panel', label: 'Панели' },
  { key: 'border', label: 'Границы' },
  { key: 'text', label: 'Текст' },
  { key: 'muted', label: 'Вторичный текст' },
  { key: 'accent', label: 'Акцент' },
];

/** '#abc' или '#aabbcc' в нижнем регистре; иначе запасное значение. */
export function normalizeHex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const short = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : fallback;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHex(hex, '#000000');
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Смесь двух цветов: weight 0 это a, 1 это b. */
export function mixHex(a: string, b: string, weight: number): string {
  const w = Math.max(0, Math.min(1, Number(weight) || 0));
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(ca.r + (cb.r - ca.r) * w, ca.g + (cb.g - ca.g) * w, ca.b + (cb.b - ca.b) * w);
}

export function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Относительная яркость по WCAG: 0 (чёрный) .. 1 (белый). */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** Контрастность по WCAG: от 1 до 21. Для обычного текста нужно не меньше 4,5. */
export function contrastRatio(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Чёрный или белый: что лучше читается на этом фоне. */
export function readableOn(background: string): '#10111a' | '#ffffff' {
  return contrastRatio('#10111a', background) >= contrastRatio('#ffffff', background) ? '#10111a' : '#ffffff';
}

/** Подтягивает цвет fg к читаемому на фоне bg, пока контраст не достигнет min (двигаясь к чёрному или белому). */
export function ensureContrast(fg: string, bg: string, min: number): string {
  let out = normalizeHex(fg, bg);
  const background = normalizeHex(bg, '#000000');
  if (contrastRatio(out, background) >= min) return out;
  const target = readableOn(background);
  for (let i = 1; i <= 24; i++) {
    out = mixHex(out, target, i / 24);
    if (contrastRatio(out, background) >= min) return out;
  }
  return target;
}

export function sanitizeCustomTheme(value: unknown): CustomTheme {
  const src = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    bg: normalizeHex(src.bg, DEFAULT_CUSTOM_THEME.bg),
    panel: normalizeHex(src.panel, DEFAULT_CUSTOM_THEME.panel),
    border: normalizeHex(src.border, DEFAULT_CUSTOM_THEME.border),
    text: normalizeHex(src.text, DEFAULT_CUSTOM_THEME.text),
    muted: normalizeHex(src.muted, DEFAULT_CUSTOM_THEME.muted),
    accent: normalizeHex(src.accent, DEFAULT_CUSTOM_THEME.accent),
  };
}

export interface DerivedTheme {
  resolved: 'light' | 'dark'; // какой набор остальных цветов (пилюли, ошибки) брать за основу
  vars: Record<string, string>; // CSS-переменные для <html>
}

/**
 * Из шести выбранных цветов получает все остальные цвета интерфейса.
 * Слишком слабые цвета (текст, вторичный текст, границы) автоматически подтягиваются до читаемых.
 */
export function deriveCustomTheme(raw: unknown): DerivedTheme {
  const c = sanitizeCustomTheme(raw);
  const bg = c.bg;
  const isLight = luminance(bg) > 0.42;

  const text = ensureContrast(c.text, bg, 4.5);
  const muted = ensureContrast(c.muted, bg, 3.1);
  const border = ensureContrast(c.border, bg, 1.25);
  const accent = c.accent;

  let panel = c.panel;
  if (contrastRatio(panel, bg) < 1.06) panel = mixHex(panel, text, isLight ? 0.08 : 0.12);

  const panel2 = isLight ? mixHex(panel, '#000000', 0.035) : mixHex(panel, text, 0.08);
  const panel3 = isLight ? mixHex(panel, '#ffffff', 0.35) : mixHex(panel, text, 0.025);
  const inputBg = isLight ? '#ffffff' : mixHex(bg, '#000000', 0.22);
  const cyan = isLight ? '#0b8f9c' : '#83e5ed';
  const taskA = mixHex(panel, text, isLight ? 0.025 : 0.055);
  const taskB = mixHex(panel, text, isLight ? 0.065 : 0.105);

  const vars: Record<string, string> = {
    '--bg': bg,
    '--panel': panel,
    '--panel2': panel2,
    '--border': border,
    '--text': text,
    '--muted': muted,
    '--accent': accent,
    '--text-strong': isLight ? mixHex(text, '#000000', 0.4) : mixHex(text, '#ffffff', 0.5),
    '--on-accent': readableOn(accent),
    '--cyan': cyan,
    '--link': cyan,
    '--link-bg': hexToRgba(cyan, 0.12),
    '--red': isLight ? '#c2384f' : '#f49aaa',
    '--green': isLight ? '#16845b' : '#5fd38d',
    '--orange': isLight ? '#b45309' : '#e6a54d',
    '--input-bg': inputBg,
    '--hover': isLight ? mixHex(panel, '#000000', 0.055) : mixHex(panel, text, 0.075),
    '--shadow': isLight ? 'rgba(15, 23, 42, .18)' : 'rgba(0, 0, 0, .52)',
    '--overlay': hexToRgba(bg, isLight ? 0.58 : 0.84),
    '--scroll': mixHex(border, text, 0.18),
    '--sidebar-bg': hexToRgba(panel, isLight ? 0.8 : 0.75),
    '--selected': mixHex(panel, accent, isLight ? 0.2 : 0.24),
    '--ring': isLight ? 'rgba(0, 0, 0, .2)' : 'rgba(255, 255, 255, .25)',
    '--swatch-ring': text,
    '--glow': mixHex(bg, accent, isLight ? 0.14 : 0.16),
    '--lane-bg': hexToRgba(panel, isLight ? 0.88 : 0.92),
    '--card-bg-1': taskA,
    '--card-bg-2': taskB,
    '--card-border': border,
    '--card-hover-border': mixHex(accent, text, 0.25),
    '--card-shadow': isLight ? 'rgba(15, 23, 42, .14)' : 'rgba(0, 0, 0, .27)',
    '--toolbar-bg': isLight ? mixHex(bg, '#ffffff', 0.45) : mixHex(panel3, '#000000', 0.12),
    '--tint': hexToRgba(text, 0.04),
    '--tint-strong': mixHex(panel, text, isLight ? 0.035 : 0.06),
    '--editor-border': mixHex(border, text, 0.1),
    '--editor-glow': hexToRgba(accent, isLight ? 0.14 : 0.2),
    '--editor-bg': panel,
    '--id-fg': cyan,
    '--id-bg': hexToRgba(cyan, 0.12),
    '--id-border': mixHex(cyan, bg, 0.6),
    '--count-bg': panel2,
  };
  return { resolved: isLight ? 'light' : 'dark', vars };
}

/** Имена переменных, которые пользовательская тема ставит на <html> (нужны, чтобы убрать их при смене темы). */
export const CUSTOM_VAR_KEYS: string[] = Object.keys(deriveCustomTheme(DEFAULT_CUSTOM_THEME).vars);

/** Предупреждения о плохой читаемости выбранных цветов (до автоподбора). */
export function themeWarnings(raw: unknown): string[] {
  const c = sanitizeCustomTheme(raw);
  const out: string[] = [];
  if (contrastRatio(c.text, c.bg) < 4.5) out.push('Основной текст может плохо читаться на фоне.');
  if (contrastRatio(c.muted, c.bg) < 3) out.push('Вторичный текст слишком блёклый.');
  if (contrastRatio(c.border, c.bg) < 1.18) out.push('Границы элементов почти не видны.');
  if (contrastRatio(c.accent, c.bg) < 2.2) out.push('Акцентный цвет может теряться на фоне.');
  return out;
}

/** «Подобрать контраст»: исправляет слабые цвета, остальные не трогает. */
export function autoFixTheme(raw: unknown): CustomTheme {
  const derived = deriveCustomTheme(raw);
  const c = sanitizeCustomTheme(raw);
  return {
    bg: c.bg,
    panel: derived.vars['--panel'],
    border: derived.vars['--border'],
    text: derived.vars['--text'],
    muted: derived.vars['--muted'],
    accent: ensureContrast(c.accent, c.bg, 3),
  };
}
