import { useEffect, useRef, useState } from 'react';
import * as api from '../features/boards/api';
import { useActions } from '../features/boards/hooks';
import { isHtmlEmpty, sanitizeHtml } from '../lib/sanitize';
import { humanizeError } from '../lib/supabase';
import type { Property, PropertyOption, Task, TaskFull, TaskValue } from '../lib/types';
import { Dialog } from './Dialog';
import { PropertyField } from './PropertyField';
import { RichTextEditor } from './RichTextEditor';

type SaveStatus = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };
type LoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

const errText = (e: unknown) => humanizeError(e instanceof Error ? e.message : String(e));
const DESCRIPTION_DELAY_MS = 1500;

/**
 * Окно карточки: название, свойства и описание. Всё сохраняется само.
 * Защита от потери и затирания:
 *  - пока есть несохранённая ошибка, окно не закрывается молча, введённое остаётся на экране;
 *  - сохранение идёт «если версия карточки не изменилась»; если её уже изменил другой человек,
 *    предлагаем загрузить свежую версию или перезаписать своей;
 *  - если с момента открытия менялось только положение карточки (перенос), конфликта нет.
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
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [title, setTitle] = useState(task.title);
  const [editorHtml, setEditorHtml] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [conflict, setConflict] = useState<TaskFull | null>(null);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // значения, известные серверу на момент последнего успешного сохранения или загрузки
  const version = useRef(task.version);
  const baseTitle = useRef(task.title);
  const baseHtml = useRef('');
  // то, что сейчас в редакторе описания
  const htmlRef = useRef('');
  const descDirty = useRef(false);
  const descTimer = useRef<number | undefined>(undefined);
  // учёт сохранений
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(new Set<Promise<unknown>>());
  const failed = useRef(new Map<string, string>());

  // ------------------------------------------------------------ загрузка свежей карточки
  useEffect(() => {
    let cancelled = false;
    api
      .getTaskFull(task.id)
      .then((full) => {
        if (cancelled) return;
        if (!full) {
          setLoad({ kind: 'error', message: 'Карточка не найдена: возможно, её удалили.' });
          return;
        }
        version.current = full.version;
        baseTitle.current = full.title;
        baseHtml.current = full.description_html;
        htmlRef.current = full.description_html;
        setTitle(full.title);
        setEditorHtml(full.description_html);
        setLoad({ kind: 'ready' });
      })
      .catch((e) => {
        if (!cancelled) setLoad({ kind: 'error', message: errText(e) });
      });
    return () => {
      cancelled = true;
      window.clearTimeout(descTimer.current);
    };
  }, [task.id]);

  // ------------------------------------------------------------ учёт сохранений
  function refreshStatus() {
    const first = failed.current.values().next();
    if (!first.done) setStatus({ kind: 'error', message: first.value });
    else if (pending.current.size === 0) setStatus({ kind: 'saved' });
  }

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

  /** Сохранения идут строго по очереди: иначе второе упёрлось бы в версию, которую только что изменило первое. */
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.current.then(fn, fn);
    queue.current = run.catch(() => undefined);
    return run;
  }

  async function apply(patch: { title?: string; description_html?: string }) {
    const saved = await actions.saveTask(boardId, task.id, patch, version.current);
    version.current = saved.version;
    if (patch.title !== undefined) baseTitle.current = patch.title;
    if (patch.description_html !== undefined) baseHtml.current = patch.description_html;
  }

  function persist(patch: { title?: string; description_html?: string }): Promise<void> {
    return enqueue(async () => {
      try {
        await apply(patch);
      } catch (e) {
        if (!(e instanceof api.ConflictError)) throw e;
        const fresh = await api.getTaskFull(task.id);
        if (!fresh) throw new Error('Карточку удалили, пока она была открыта.');
        if (fresh.title === baseTitle.current && fresh.description_html === baseHtml.current) {
          // менялось только положение карточки: это не конфликт, берём новую версию и сохраняем
          version.current = fresh.version;
          await apply(patch);
          return;
        }
        setConflict(fresh);
        throw e;
      }
    });
  }

  // ------------------------------------------------------------ название и описание
  async function saveTitle(): Promise<boolean> {
    if (load.kind !== 'ready') return true;
    const value = title.trim();
    if (value === '') {
      setTitle(baseTitle.current); // пустое название не сохраняем
      return true;
    }
    if (value === baseTitle.current) return true;
    try {
      await track('title', persist({ title: value }));
      return true;
    } catch {
      return false;
    }
  }

  async function flushDescription(): Promise<boolean> {
    window.clearTimeout(descTimer.current);
    if (!descDirty.current) return true;
    let clean = sanitizeHtml(htmlRef.current);
    if (isHtmlEmpty(clean)) clean = '';
    if (clean === baseHtml.current) {
      descDirty.current = false;
      return true;
    }
    descDirty.current = false;
    try {
      await track('desc', persist({ description_html: clean }));
      return true;
    } catch {
      descDirty.current = true; // не потеряем при закрытии: попробуем снова
      return false;
    }
  }

  function onDescriptionChange(html: string) {
    htmlRef.current = html;
    descDirty.current = true;
    window.clearTimeout(descTimer.current);
    descTimer.current = window.setTimeout(() => void flushDescription(), DESCRIPTION_DELAY_MS);
  }

  // ------------------------------------------------------------ конфликт
  function loadFresh() {
    if (!conflict) return;
    version.current = conflict.version;
    baseTitle.current = conflict.title;
    baseHtml.current = conflict.description_html;
    htmlRef.current = conflict.description_html;
    descDirty.current = false;
    failed.current.clear();
    setTitle(conflict.title);
    setEditorHtml(conflict.description_html);
    setEditorKey((k) => k + 1);
    setConflict(null);
    setStatus({ kind: 'saved' });
  }

  async function overwriteWithMine() {
    if (!conflict) return;
    version.current = conflict.version;
    baseTitle.current = conflict.title;
    baseHtml.current = conflict.description_html;
    failed.current.clear();
    setConflict(null);
    await saveTitle();
    descDirty.current = true;
    await flushDescription();
  }

  // ------------------------------------------------------------ закрытие
  async function requestClose() {
    const titleOk = await saveTitle();
    const descOk = await flushDescription();
    await Promise.allSettled([...pending.current]);
    if (!titleOk || !descOk || failed.current.size > 0) {
      setCloseBlocked(true);
      return;
    }
    onClose();
  }

  const valueOf = (propertyId: string) => values.find((v) => v.property_id === propertyId);
  const ready = load.kind === 'ready';

  return (
    <Dialog title={`Карточка #${task.number}`} wide={!fullscreen} full={fullscreen} onClose={() => void requestClose()}>
      <button
        type="button"
        className="icon-btn dialog-corner"
        title={fullscreen ? 'Обычный размер' : 'Развернуть на весь экран'}
        aria-label={fullscreen ? 'Обычный размер' : 'Развернуть на весь экран'}
        onClick={() => setFullscreen((f) => !f)}
      >
        {fullscreen ? '⤡' : '⤢'}
      </button>

      <label className="label" htmlFor="taskTitle">Название</label>
      <input
        id="taskTitle"
        className="field"
        maxLength={300}
        autoFocus
        value={title}
        disabled={!ready}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void saveTitle()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />

      {properties.length > 0 && (
        <details className="props-section" open>
          <summary>Свойства</summary>
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
        </details>
      )}

      <div className="label">Описание</div>
      {load.kind === 'loading' && <div className="muted rich-loading">Загружаем карточку…</div>}
      {load.kind === 'error' && <div className="error">{load.message}</div>}
      {ready && (
        <RichTextEditor
          key={editorKey}
          html={editorHtml}
          onChange={onDescriptionChange}
          onBlur={() => void flushDescription()}
        />
      )}

      {conflict && (
        <div className="conflict" role="alert">
          <strong>Карточку уже изменил кто-то другой.</strong> То, что ты написала, осталось на экране и пока не сохранено.
          <div className="row end">
            <button className="btn small" type="button" onClick={loadFresh}>
              Загрузить свежую версию
            </button>
            <button className="btn small primary" type="button" onClick={() => void overwriteWithMine()}>
              Перезаписать моими изменениями
            </button>
          </div>
        </div>
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
