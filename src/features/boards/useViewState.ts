import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SavedView } from '../../lib/types';
import { DEFAULT_CONFIG, normalizeConfig, sameConfig, type ViewConfig } from '../../lib/viewConfig';

const storageKey = (boardId: string) => `qaflow.view.${boardId}`;

function readStored(boardId: string): string | null {
  try {
    return localStorage.getItem(storageKey(boardId));
  } catch {
    return null;
  }
}

function writeStored(boardId: string, id: string | null) {
  try {
    if (id) localStorage.setItem(storageKey(boardId), id);
    else localStorage.removeItem(storageKey(boardId));
  } catch {
    /* выбор представления просто не запомнится */
  }
}

/**
 * Рабочее состояние представления: выбранная вкладка и текущие настройки (фильтры, сортировка, вид карточек).
 * Правка настроек не меняет сохранённое представление, пока его не сохранили: чужие вкладки это не затрагивает.
 * Выбранная вкладка запоминается в этом браузере.
 */
export function useViewState(boardId: string, views: SavedView[], viewsLoaded: boolean) {
  const [activeId, setActiveId] = useState<string | null>(() => readStored(boardId));
  const [config, setConfig] = useState<ViewConfig>(DEFAULT_CONFIG);
  const initialized = useRef(false);
  const seen = useRef(new Set<string>()); // представления, которые уже появлялись в списке

  const activeView = useMemo(() => views.find((v) => v.id === activeId) ?? null, [views, activeId]);
  const base: ViewConfig = useMemo(
    () => (activeView ? normalizeConfig(activeView.config) : DEFAULT_CONFIG),
    [activeView],
  );

  // Когда список представлений загрузился: открываем запомненное или, если его уже нет, общий вид
  useEffect(() => {
    if (!viewsLoaded) return;
    for (const v of views) seen.current.add(v.id);
    if (!initialized.current) {
      initialized.current = true;
      if (activeView) setConfig(base);
      else if (activeId !== null) {
        setActiveId(null);
        writeStored(boardId, null);
      }
      return;
    }
    // представление удалили (например, другой участник), пока оно было открыто.
    // Только что созданное, которого в списке ещё нет, не в счёт: его id ещё не встречался.
    if (activeId !== null && !activeView && seen.current.has(activeId)) {
      setActiveId(null);
      setConfig(DEFAULT_CONFIG);
      writeStored(boardId, null);
    }
  }, [viewsLoaded, views, activeView, activeId, base, boardId]);

  /** Открывает вкладку. keepConfig: оставить текущие настройки (после «Сохранить как»). */
  const select = useCallback(
    (id: string | null, keepConfig = false) => {
      setActiveId(id);
      writeStored(boardId, id);
      if (!keepConfig) {
        const view = id ? views.find((v) => v.id === id) : undefined;
        setConfig(view ? normalizeConfig(view.config) : DEFAULT_CONFIG);
      }
    },
    [boardId, views],
  );

  const update = useCallback((patch: Partial<ViewConfig>) => setConfig((c) => ({ ...c, ...patch })), []);
  const reset = useCallback(() => setConfig(base), [base]);
  const dirty = !sameConfig(config, base);

  return { activeId, activeView, config, dirty, select, update, reset };
}
