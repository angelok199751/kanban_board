import type { SavedView } from '../lib/types';

/** Вкладки представлений и кнопки сохранения. Пока настройки не сохранены, они действуют только у тебя. */
export function ViewBar({
  views,
  activeId,
  dirty,
  onSelect,
  onSave,
  onSaveAs,
  onReset,
  onManage,
}: {
  views: SavedView[];
  activeId: string | null;
  dirty: boolean;
  onSelect: (id: string | null) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onReset: () => void;
  onManage: (view: SavedView) => void;
}) {
  const active = views.find((v) => v.id === activeId) ?? null;

  return (
    <div className="view-bar">
      <div className="view-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeId === null}
          className={activeId === null ? 'view-tab active' : 'view-tab'}
          onClick={() => onSelect(null)}
        >
          Все задачи
        </button>
        {views.map((v) => (
          <span key={v.id} className={v.id === activeId ? 'view-tab-wrap active' : 'view-tab-wrap'}>
            <button
              type="button"
              role="tab"
              aria-selected={v.id === activeId}
              className={v.id === activeId ? 'view-tab active' : 'view-tab'}
              onClick={() => onSelect(v.id)}
              title={v.owner_id === null ? 'Общее представление' : 'Личное представление: видишь только ты'}
            >
              {v.name}
              {v.owner_id !== null && <span className="view-tag">личное</span>}
            </button>
            {v.id === activeId && (
              <button type="button" className="icon-btn" title="Переименовать или удалить" aria-label="Настроить представление" onClick={() => onManage(v)}>
                ⋯
              </button>
            )}
          </span>
        ))}
      </div>

      {dirty && (
        <div className="view-actions">
          <span className="muted small-text">Настройки изменены</span>
          {active && (
            <button type="button" className="btn small primary" onClick={onSave}>
              Сохранить
            </button>
          )}
          <button type="button" className="btn small" onClick={onSaveAs}>
            Сохранить как…
          </button>
          <button type="button" className="btn small" onClick={onReset}>
            Сбросить
          </button>
        </div>
      )}
    </div>
  );
}
