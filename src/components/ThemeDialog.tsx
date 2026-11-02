import { autoFixTheme, DEFAULT_CUSTOM_THEME, THEME_FIELDS, themeWarnings, type CustomTheme } from '../lib/color';
import type { ThemeMode } from '../lib/theme';
import { Dialog } from './Dialog';
import { Pill } from './TaskCard';

const MODES: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: 'Тёмная' },
  { value: 'light', label: 'Светлая' },
  { value: 'system', label: 'Системная' },
  { value: 'custom', label: 'Пользовательская' },
];

/**
 * Тема интерфейса: тёмная, светлая, как в системе или своя (шесть цветов).
 * Изменения применяются сразу и запоминаются в этом браузере; у других участников тема не меняется.
 */
export function ThemeDialog({
  mode,
  custom,
  onMode,
  onCustom,
  onClose,
}: {
  mode: ThemeMode;
  custom: CustomTheme;
  onMode: (mode: ThemeMode) => void;
  onCustom: (theme: CustomTheme) => void;
  onClose: () => void;
}) {
  const warnings = mode === 'custom' ? themeWarnings(custom) : [];

  return (
    <Dialog title="Тема интерфейса" editor extraClass="theme-dialog" onClose={onClose}>
      <header className="editor-header">
        <h2 className="dialog-title">Тема интерфейса</h2>
        <div className="header-tools">
          <button type="button" className="icon-btn" title="Закрыть" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        </div>
      </header>

      <div className="theme-body">
        <div className="segmented" role="radiogroup" aria-label="Тема интерфейса">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              className={mode === m.value ? 'segment active' : 'segment'}
              onClick={() => onMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'custom' && (
          <section className="theme-custom" aria-label="Цвета пользовательской темы">
            <div className="color-grid">
              {THEME_FIELDS.map((f) => (
                <label key={f.key} className="color-field">
                  <span>{f.label}</span>
                  <input
                    type="color"
                    value={custom[f.key]}
                    aria-label={f.label}
                    onChange={(e) => onCustom({ ...custom, [f.key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <div className="row">
              <button className="btn" type="button" onClick={() => onCustom(autoFixTheme(custom))}>
                Подобрать контраст
              </button>
              <button className="btn" type="button" onClick={() => onCustom({ ...DEFAULT_CUSTOM_THEME })}>
                Сбросить тему
              </button>
            </div>
            {warnings.length > 0 && (
              <div className="theme-warning" role="status">
                {warnings.join(' ')} Нажми «Подобрать контраст»: слабые цвета подтянутся до читаемых.
              </div>
            )}
          </section>
        )}

        <section className="theme-preview" aria-label="Пример карточки">
          <h3>Пример карточки</h3>
          <div className="task-meta">
            <Pill field={{ id: 'a', name: 'Статус', type: 'select', text: 'Статус', tone: 'purple' }} />
            <Pill field={{ id: 'b', name: 'Флоу', type: 'select', text: 'Флоу', tone: 'blue' }} />
            <Pill field={{ id: 'c', name: 'Категория', type: 'select', text: 'Категория', tone: 'green' }} />
          </div>
          <p className="muted">Так будут выглядеть свойства, описание и служебные элементы в выбранной теме.</p>
          <button className="btn primary" type="button">
            Основное действие
          </button>
        </section>
      </div>

      <footer className="editor-footer">
        <span className="muted">Тема сохраняется только в этом браузере.</span>
        <div className="row">
          <button className="btn" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </footer>
    </Dialog>
  );
}
