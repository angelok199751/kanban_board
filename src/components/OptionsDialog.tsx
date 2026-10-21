import { useState } from 'react';
import { useActions } from '../features/boards/hooks';
import { COLORS, COLOR_NAMES } from '../lib/colors';
import { useNotice } from '../lib/notice';
import { humanizeError } from '../lib/supabase';
import type { ColorName, Property, PropertyOption } from '../lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';

const errText = (e: unknown) => humanizeError(e instanceof Error ? e.message : String(e));

/** Варианты выпадающего списка: изменения применяются сразу. */
export function OptionsDialog({
  boardId,
  property,
  options,
  onClose,
}: {
  boardId: string;
  property: Property;
  options: PropertyOption[];
  onClose: () => void;
}) {
  const actions = useActions();
  const { notify } = useNotice();
  const [paletteFor, setPaletteFor] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<{ option: PropertyOption; usage: number } | null>(null);

  async function add() {
    const label = newLabel.trim();
    if (label === '') return;
    setAdding(true);
    try {
      await actions.createOption(boardId, property.id, label, 'gray');
      setNewLabel('');
    } catch (e) {
      notify(`Не удалось добавить вариант: ${errText(e)}`);
    } finally {
      setAdding(false);
    }
  }

  async function rename(option: PropertyOption, value: string) {
    const label = value.trim();
    if (label === option.label) return;
    if (label === '') {
      notify('Название варианта не может быть пустым.');
      return;
    }
    try {
      await actions.updateOption(boardId, option.id, { label });
    } catch (e) {
      notify(`Не удалось переименовать вариант: ${errText(e)}`);
    }
  }

  async function recolor(option: PropertyOption, color: ColorName) {
    setPaletteFor(null);
    try {
      await actions.updateOption(boardId, option.id, { color });
    } catch (e) {
      notify(`Не удалось сменить цвет: ${errText(e)}`);
    }
  }

  async function askDelete(option: PropertyOption) {
    const usage = actions.optionUsage(boardId, option.id);
    if (usage === 0) {
      try {
        await actions.deleteOption(boardId, option.id);
      } catch (e) {
        notify(`Не удалось удалить вариант: ${errText(e)}`);
      }
      return;
    }
    setToDelete({ option, usage });
  }

  return (
    <>
      <Dialog title={`Варианты: ${property.name}`} onClose={onClose}>
        <div className="options-list">
          {options.length === 0 && <div className="muted">Вариантов пока нет.</div>}
          {options.map((o) => (
            <div key={o.id} className="option-block">
              <div className="option-row">
                <button
                  type="button"
                  className="color-dot"
                  style={{ background: COLORS[o.color] }}
                  title="Сменить цвет"
                  aria-label="Сменить цвет"
                  onClick={() => setPaletteFor(paletteFor === o.id ? null : o.id)}
                />
                <input
                  key={`${o.id}:${o.label}`}
                  className="field"
                  maxLength={60}
                  defaultValue={o.label}
                  onBlur={(e) => void rename(o, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  title="Удалить вариант"
                  aria-label="Удалить вариант"
                  onClick={() => void askDelete(o)}
                >
                  ✕
                </button>
              </div>
              {paletteFor === o.id && (
                <div className="swatches">
                  {COLOR_NAMES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      className={c === o.color ? 'swatch selected' : 'swatch'}
                      style={{ background: COLORS[c] }}
                      onClick={() => void recolor(o, c)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="option-row add-row">
          <input
            className="field"
            placeholder="Новый вариант"
            maxLength={60}
            value={newLabel}
            disabled={adding}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add();
            }}
          />
          <button className="btn primary small" type="button" disabled={adding || newLabel.trim() === ''} onClick={() => void add()}>
            Добавить
          </button>
        </div>

        <div className="row end">
          <button className="btn" type="button" onClick={onClose}>
            Готово
          </button>
        </div>
      </Dialog>

      {toDelete && (
        <ConfirmDialog
          title="Удалить вариант?"
          confirmLabel="Удалить и очистить значения"
          onConfirm={() => actions.deleteOption(boardId, toDelete.option.id)}
          onClose={() => setToDelete(null)}
        >
          Вариант «{toDelete.option.label}» выбран в карточках: {toDelete.usage}. Если удалить его, это свойство
          у этих карточек станет пустым. Отменить это действие нельзя.
        </ConfirmDialog>
      )}
    </>
  );
}
