import { useEffect, useRef, useState } from 'react';
import { ValueConflictError } from '../features/boards/api';
import { formatDate, isValidUrl } from '../lib/format';
import { compareByPosition } from '../lib/positions';
import { humanizeError } from '../lib/supabase';
import type { Property, PropertyOption, TaskValue } from '../lib/types';
import { selectedOptionIds } from '../lib/values';
import { PillSelect } from './PillSelect';

/**
 * Поле значения свойства в окне карточки. Сохраняется само:
 * список и дата сразу при выборе, текст и ссылка при выходе из поля.
 * onSave получает null (очистить), id варианта, массив id для списка с несколькими значениями,
 * текст или 'YYYY-MM-DD'; force записывает поверх чужого изменения.
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
  onSave: (raw: string | string[] | null, force?: boolean) => Promise<void>;
  onDiscard: () => void;
}) {
  const saved = property.type === 'date' ? (value?.value_date ?? '') : (value?.value_text ?? '');
  const savedIds = property.type === 'select' ? selectedOptionIds(value) : [];
  const savedIdsKey = savedIds.join('|');
  const [text, setText] = useState(saved);
  const [multiIds, setMultiIds] = useState<string[]>(savedIds);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ raw: string | string[] | null } | null>(null);
  const [editingLink, setEditingLink] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);

  // Множественный выбор применяется сразу, поэтому локальный список должен обновляться без ожидания базы.
  const multiRef = useRef(multiIds);
  multiRef.current = multiIds;
  const lastSavedIds = useRef(savedIdsKey);
  useEffect(() => {
    if (multiRef.current.join('|') === lastSavedIds.current) setMultiIds(savedIds);
    lastSavedIds.current = savedIdsKey;
  }, [savedIdsKey]);

  // Подхватываем чужое изменение, только если в поле нет ничего, что человек ввёл сам и ещё не сохранил
  const textRef = useRef(text);
  textRef.current = text;
  const lastSaved = useRef(saved);
  useEffect(() => {
    if (textRef.current === lastSaved.current) setText(saved);
    lastSaved.current = saved;
  }, [saved]);

  /** Возвращает true, если значение сохранено. При ошибке или конфликте введённое остаётся в поле. */
  async function save(raw: string | string[] | null, force = false): Promise<boolean> {
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
    setMultiIds(savedIds);
    setConflict(null);
    setError(null);
    setEditingLink(false);
    onDiscard();
  }

  /** Календарь открывается по клику на всё поле, а не только на иконку. */
  function openDatePicker() {
    const input = dateRef.current;
    if (!input) return;
    input.focus();
    const picker = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof picker.showPicker === 'function') {
      try {
        picker.showPicker();
      } catch {
        /* браузер может запретить вызов: остаётся обычное поведение поля */
      }
    } else {
      input.click();
    }
  }

  /** Что сейчас лежит в базе, в читаемом виде. */
  function currentDisplay(): string {
    if (property.type === 'select') {
      const labels = selectedOptionIds(value)
        .map((id) => options.find((x) => x.id === id)?.label)
        .filter((label): label is string => label !== undefined);
      return labels.length > 0 ? labels.join(', ') : 'не выбрано';
    }

    if (property.type === 'date') return saved ? formatDate(saved) : 'пусто';
    return saved !== '' ? saved : 'пусто';
  }

  let control;
  if (property.type === 'select') {
    const list = options.filter((o) => o.property_id === property.id).sort(compareByPosition);
    control = property.multiple ? (
      <PillSelect
        multiple
        label={property.name}
        options={list}
        value={multiIds}
        onChange={(next) => {
          const ids = Array.isArray(next) ? next : next === null ? [] : [next];
          setMultiIds(ids);
          void save(ids.length > 0 ? ids : null);
        }}
      />
    ) : (
      <PillSelect
        label={property.name}
        options={list}
        value={selectedOptionIds(value)[0] ?? null}
        onChange={(next) => {
          const id = Array.isArray(next) ? (next[0] ?? null) : next;
          void save(id);
        }}
      />
    );
  } else if (property.type === 'date') {
    control = (
      <div
        className="date-field"
        onClick={openDatePicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDatePicker();
          }
        }}
      >
        <input
          ref={dateRef}
          className="field"
          type="date"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            void save(e.target.value === '' ? null : e.target.value);
          }}
        />
      </div>
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
