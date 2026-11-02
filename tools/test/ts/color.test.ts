import {
  autoFixTheme, contrastRatio, CUSTOM_VAR_KEYS, DEFAULT_CUSTOM_THEME, deriveCustomTheme, ensureContrast, hexToRgb,
  luminance, mixHex, normalizeHex, readableOn, sanitizeCustomTheme, themeWarnings,
} from '../../../src/lib/color';

const eq = (a: unknown, b: unknown, m: string) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`); };
const near = (a: number, b: number, m: string, eps = 0.02) => { if (Math.abs(a - b) > eps) throw new Error(`FAIL ${m}: ${a} !≈ ${b}`); };

eq(normalizeHex('#ABC', '#000000'), '#aabbcc', 'short hex');
eq(normalizeHex('красный', '#123456'), '#123456', 'garbage falls back');
eq(normalizeHex(' #FFFFFF ', '#000000'), '#ffffff', 'trim and lowercase');
eq(hexToRgb('#102030'), { r: 16, g: 32, b: 48 }, 'rgb');
eq(mixHex('#000000', '#ffffff', 0.5), '#808080', 'mix');
eq(mixHex('#102030', '#ffffff', 0), '#102030', 'mix 0');

near(luminance('#000000'), 0, 'black'); near(luminance('#ffffff'), 1, 'white');
near(contrastRatio('#000000', '#ffffff'), 21, 'max contrast', 0.01);
near(contrastRatio('#777777', '#777777'), 1, 'same colors', 0.001);
eq(readableOn('#ffffff'), '#10111a', 'dark text on white');
eq(readableOn('#101010'), '#ffffff', 'white text on dark');

// ensureContrast: слабый серый на белом темнеет до читаемого, уже читаемый не меняется
const fixed = ensureContrast('#cccccc', '#ffffff', 4.5);
if (contrastRatio(fixed, '#ffffff') < 4.5) throw new Error('contrast not reached: ' + fixed);
eq(ensureContrast('#000000', '#ffffff', 4.5), '#000000', 'good color untouched');

// пользовательская тема
const def = deriveCustomTheme(DEFAULT_CUSTOM_THEME);
eq(def.resolved, 'dark', 'default is dark');
eq(def.vars['--bg'], '#11121b', 'bg kept');
eq(def.vars['--accent'], '#b9a5ff', 'accent kept');
eq(CUSTOM_VAR_KEYS.length > 30, true, 'many derived vars');
eq(CUSTOM_VAR_KEYS.every((k) => k.startsWith('--')), true, 'css var names');

const light = deriveCustomTheme({ ...DEFAULT_CUSTOM_THEME, bg: '#f4f5fa', panel: '#ffffff', text: '#1d2033' });
eq(light.resolved, 'light', 'light background resolves to light');
eq(light.vars['--input-bg'], '#ffffff', 'inputs are white on light');

// слабые цвета подтягиваются автоматически, читаемость гарантирована
const bad = deriveCustomTheme({ bg: '#ffffff', panel: '#ffffff', border: '#fefefe', text: '#eeeeee', muted: '#f0f0f0', accent: '#ffffff' });
if (contrastRatio(bad.vars['--text'], bad.vars['--bg']) < 4.5) throw new Error('text contrast not ensured');
if (contrastRatio(bad.vars['--muted'], bad.vars['--bg']) < 3.1) throw new Error('muted contrast not ensured');
if (contrastRatio(bad.vars['--panel'], bad.vars['--bg']) < 1.05) throw new Error('panel indistinguishable from bg');

eq(themeWarnings(DEFAULT_CUSTOM_THEME), [], 'default theme has no warnings');
eq(themeWarnings({ ...DEFAULT_CUSTOM_THEME, text: '#2a2c3f' }).length >= 1, true, 'weak text warns');

const fixedTheme = autoFixTheme({ ...DEFAULT_CUSTOM_THEME, text: '#2a2c3f', muted: '#1f2133' });
eq(themeWarnings(fixedTheme), [], 'auto fix removes warnings');
eq(fixedTheme.bg, DEFAULT_CUSTOM_THEME.bg, 'auto fix keeps background');
eq(sanitizeCustomTheme(null), DEFAULT_CUSTOM_THEME, 'null sanitized to defaults');
eq(sanitizeCustomTheme({ bg: 'zzz', accent: '#ABCDEF' }).accent, '#abcdef', 'partial object');
console.log('color tests ok');
