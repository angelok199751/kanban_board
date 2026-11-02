import { useCallback, useEffect, useState } from 'react';
import {
  CUSTOM_VAR_KEYS,
  DEFAULT_CUSTOM_THEME,
  deriveCustomTheme,
  sanitizeCustomTheme,
  type CustomTheme,
} from './color';

export type ThemeMode = 'dark' | 'light' | 'system' | 'custom';

// ключи те же, что в старой версии QA Flow
const MODE_KEY = 'qaflow.themeMode';
const CUSTOM_KEY = 'qaflow.customTheme';
// готовые переменные пользовательской темы: по ним index.html красит страницу до загрузки приложения
const VARS_KEY = 'qaflow.themeVars';

export function readThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'light' || v === 'system' || v === 'custom' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export function readCustomTheme(): CustomTheme {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return sanitizeCustomTheme(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_CUSTOM_THEME };
  }
}

export function resolveTheme(mode: ThemeMode, custom: CustomTheme): 'dark' | 'light' {
  if (mode === 'custom') return deriveCustomTheme(custom).resolved;
  if (mode === 'system') return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return mode;
}

/** Ставит тему на <html>. Для пользовательской темы ещё и все производные цвета. */
export function applyTheme(mode: ThemeMode, custom: CustomTheme) {
  const root = document.documentElement;
  for (const key of CUSTOM_VAR_KEYS) root.style.removeProperty(key);

  let resolved: 'dark' | 'light';
  if (mode === 'custom') {
    const derived = deriveCustomTheme(custom);
    resolved = derived.resolved;
    for (const [key, value] of Object.entries(derived.vars)) root.style.setProperty(key, value);
    try {
      localStorage.setItem(VARS_KEY, JSON.stringify({ resolved, vars: derived.vars }));
    } catch {
      /* без сохранения: тема применится, но страница при загрузке мигнёт */
    }
  } else {
    resolved = resolveTheme(mode, custom);
    try {
      localStorage.removeItem(VARS_KEY);
    } catch {
      /* ничего */
    }
  }
  root.dataset.theme = mode;
  root.dataset.resolvedTheme = resolved;
  root.style.colorScheme = resolved;
}

/**
 * Режим и цвета темы с сохранением в этом браузере. В режиме «как в системе» следит за настройкой системы.
 * Тема личная: у других участников она не меняется.
 */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(readThemeMode);
  const [custom, setCustomState] = useState<CustomTheme>(readCustomTheme);

  useEffect(() => {
    applyTheme(mode, custom);
    if (mode !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyTheme('system', custom);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode, custom]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* тема сбросится при перезагрузке */
    }
  }, []);

  const setCustom = useCallback((next: CustomTheme) => {
    const clean = sanitizeCustomTheme(next);
    setCustomState(clean);
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(clean));
    } catch {
      /* цвета не запомнятся */
    }
  }, []);

  return { mode, setMode, custom, setCustom };
}
