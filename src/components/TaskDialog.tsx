import { useRef, useState } from 'react';
import { useActions } from '../features/boards/hooks';
import { humanizeError } from '../lib/supabase';
import type { Property, PropertyOption, Task, TaskValue } from '../lib/types';
import { Dialog } from './Dialog';
import { PropertyField } from './PropertyField';

type SaveStatus = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

const errText = (e: unknown) => humanizeError(e instanceof Error ? e.message : String(e));

/**
 * Окно карточки: название и свойства, всё сохраняется само.
 * Пока есть несохранённая ошибка, окно не закрывается молча: введённое не теряется.
 */
export function TaskDialog({
  boardId,
  task,
  properties,
  options,
  values,
  onClose,
}: {
  boardId: string;
  task: Task;
  properties: Property[];
  options: PropertyOption[];
  values: TaskValue[];
  onClose: () => void;
}) {
  const actions = useActions();
  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const savedTitle = useRef(task.title);
  const version = useRef(task.version);
  const pending = useRef(new Set<Promise<unknown>>());
  const failed = useRef(new Map<string, string>());

  function refreshStatus() {
    const first = failed.current.values().next();
    if (!first.done) setStatus({ kind: 'error', message: first.value });
    else if (pending.current.size === 0) setStatus({ kind: 'saved' });
  }

  /** Оборачивает сохранение: показывает статус и запоминает неудачи по ключу поля. */
  async function track<T>(key: string, work: Promise<T>): Promise<T> {
    pending.current.add(work);
    setStatus({ kind: 'saving' });
    try {
      const result = await work;
      failed.current.delete(key);
      return result;
    } catch (e) {
      failed.current.set(key, errText(e));
      throw e;
    } finally {
      pending.current.delete(work);
      refreshStatus();
    }
  }

  async function saveTitle(): Promise<boolean> {
    const value = title.trim();
    if (value === '') {
      setTitle(savedTitle.current); // пустое название не сохраняем
      return true;
    }
    if (value === savedTitle.current) return true;
    try {
      const updated = await track('title', actions.renameTask(boardId, { ...task, version: version.current }, value));
      version.current = updated.version;
      savedTitle.current = updated.title;
      return true;
    } catch {
      return false;
    }
  }

  const valueOf = (propertyId: string) => values.find((v) => v.property_id === propertyId);

  const [closeBlocked, setCloseBlocked] = useState(false);

  async function requestClose() {
    const titleOk = await saveTitle();
    await Promise.allSettled([...pending.current]);
    if (!titleOk || failed.current.size > 0) {
      setCloseBlocked(true);
      return;
    }
    onClose();
  }

  return (
    <Dialog title={`Карточка #${task.number}`} wide onClose={() => void requestClose()}>
      <label className="label" htmlFor="taskTitle">Название</label>
      <input
        id="taskTitle"
        className="field"
        maxLength={300}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void saveTitle()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />

      {properties.length > 0 ? (
        <div className="fields-grid">
          {properties.map((p) => (
            <div key={p.id} className="field-block">
              <div className="label">{p.name}</div>
              <PropertyField
                property={p}
                options={options}
                value={valueOf(p.id)}
                onSave={(raw) => track(`p:${p.id}`, actions.setTaskValue(boardId, task.id, p, raw))}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small-note">Свойств пока нет. Их можно добавить кнопкой «Свойства» над доской.</p>
      )}

      <div className={status.kind === 'error' ? 'save-status error-text' : 'save-status'} role="status">
        {status.kind === 'idle' && 'Изменения сохраняются автоматически'}
        {status.kind === 'saving' && 'Сохраняем…'}
        {status.kind === 'saved' && 'Все изменения сохранены'}
        {status.kind === 'error' && `Не сохранено: ${status.message}`}
      </div>

      <div className="row end">
        {closeBlocked && (
          <button className="btn" type="button" onClick={onClose}>
            Закрыть без сохранения
          </button>
        )}
        <button className="btn primary" type="button" onClick={() => void requestClose()}>
          Готово
        </button>
      </div>
    </Dialog>
  );
}
