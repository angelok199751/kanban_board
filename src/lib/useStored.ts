import { useCallback, useState } from 'react';

/**
 * Настройка, которая запоминается в этом браузере (например, раскладка окна карточки).
 * parse проверяет сохранённую строку: чужое или устаревшее значение заменяется значением по умолчанию.
 */
export function useStored<T extends string | boolean>(
  key: string,
  initial: T,
  parse: (raw: string) => T | null,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw === null ? null : parse(raw);
      return parsed === null ? initial : parsed;
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        /* настройка просто не запомнится */
      }
    },
    [key],
  );
  return [value, set];
}

/** Набор id (например, свёрнутые столбцы доски), хранится в браузере. */
export function readIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeIdSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* без сохранения */
  }
}
