import { useEffect, useRef, useState } from 'react';
import { ValueConflictError } from '../features/boards/api';
import { formatDate, isValidUrl } from '../lib/format';
import { compareByPosition } from '../lib/positions';
import { humanizeError } from '../lib/supabase';
import type { Property, PropertyOption, TaskValue } from '../lib/types';
import { PillSelect } from './PillSelect';

/**
 * Поле значения свойства в окне карточки. Сохраняется само:
 * список и дата сразу при выборе, текст и ссылка при выходе из поля.
 * onSave получает null (очистить), id варианта, текст или 'YYYY-MM-DD'; force записывает поверх чужого изменения.
 *
 * Значения-списки показываются цветными капсулами, сохранённая ссылка читается ссылкой с кнопкой «изменить».
 * Если значение тем временем изменил другой участник, введённое не пропадает: показываем, что там сейчас,
 * и предлагаем оставить своё или взять текущее. Чужие изменения, пришедшие, пока ты ничего не меняла
 * в этом поле, подставляются сами.
 */
export function PropertyField({
  property,
  options,
  value,
  onSave,
  onDiscard,
}: {
  property: Property;
  options: PropertyOption[];
  value: TaskValue | undefined;
  onSave: (raw: string | null, force?: boolean) => Promise<void>;
  onDiscard: () => void;
}) {
  const saved = property.type === 'date' ? (value?.value_date ?? '') : (value?.value_text ?? '');
  const [text, setText] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ raw: string | null } | null>(null);
  const [editingLink, setEditingLink] = useState(false);

  // Подхватываем чужое изменение, только если в поле нет ничего, что человек ввёл сам и ещё не сохранил
  const textRef = useRef(text);
  textRef.current = text;
  const lastSaved = useRef(saved);
  useEffect(() => {
    if (textRef.current === lastSaved.current) setText(saved);
    lastSaved.current = saved;
  }, [saved]);

  /** Возвращает true, если значение сохранено. При ошибке или конфликте введённое остаётся в поле. */
  async function save(raw: string | null, force = false): Promise<boolean> {
    setError(null);
    try {
      await onSave(raw, force);
      setConflict(null);
      return true;
    } catch (e) {
      if (e instanceof ValueConflictError) setConflict({ raw });
      else setError(humanizeError(e instanceof Error ? e.message : String(e)));
      return false;
    }
  }

  function commitText() {
    const v = text.trim();
    if (v === saved) {
      setEditingLink(false);
      return;
    }
    // формат ссылки проверяет база: ошибка попадает в статус окна, и введённое не теряется при закрытии
    void save(v === '' ? null : v).then((ok) => {
      if (ok) setEditingLink(false);
    });
  }

  function takeCurrent() {
    setText(saved);
    setConflict(null);
    setError(null);
    setEditingLink(false);
    onDiscard();
  }

  /** Что сейчас лежит в базе, в читаемом виде. */
  function currentDisplay(): string {
    if (property.type === 'select') {
      const o = options.find((x) => x.id === value?.option_id);
      return o ? o.label : 'не выбрано';
    }
    if (property.type === 'date') return saved ? formatDate(saved) : 'пусто';
    return saved !== '' ? saved : 'пусто';
  }

  let control;
  if (property.type === 'select') {
    const list = options.filter((o) => o.property_id === property.id).sort(compareByPosition);
    control = <PillSelect label={property.name} options={list} value={value?.option_id ?? null} onChange={(id) => void save(id)} />;
  } else if (property.type === 'date') {
    control = (
      <input
        className="field"
        type="date"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          void save(e.target.value === '' ? null : e.target.value);
        }}
      />
    );
  } else if (property.type === 'url' && saved !== '' && isValidUrl(saved) && !editingLink) {
    control = (
      <div className="link-view">
        <a className="link-text" href={saved} target="_blank" rel="noopener noreferrer" title={saved}>
          {saved}
        </a>
        <button type="button" className="icon-btn" title="Изменить ссылку" aria-label="Изменить ссылку" onClick={() => setEditingLink(true)}>
          ✎
        </button>
      </div>
    );
  } else {
    control = (
      <div className="field-with-link">
        <input
          className="field"
          type="text"
          maxLength={property.type === 'url' ? 2000 : 500}
          placeholder={property.type === 'url' ? 'https://…' : ''}
          autoFocus={editingLink}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </div>
    );
  }

  return (
    <>
      {control}
      {conflict && (
        <div className="conflict small-conflict" role="alert">
          Это значение уже изменил другой участник. Сейчас там: «{currentDisplay()}».
          <div className="row end">
            <button className="btn small" type="button" onClick={takeCurrent}>
              Взять текущее
            </button>
            <button className="btn small primary" type="button" onClick={() => void save(conflict.raw, true)}>
              Оставить моё
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="error small-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
