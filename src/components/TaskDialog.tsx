import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../features/boards/api';
import { useActions } from '../features/boards/hooks';
import { useCollabDoc } from '../features/collab/useCollabDoc';
import { colorForUser } from '../features/collab/userColor';
import { useAuth } from '../auth/AuthProvider';
import { buildCardFields } from '../lib/cardFields';
import { isHtmlEmpty, sanitizeHtml } from '../lib/sanitize';
import { humanizeError } from '../lib/supabase';
import { useStored } from '../lib/useStored';
import type { Property, PropertyOption, Task, TaskFull, TaskValue } from '../lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { LayoutSwitch, parseLayout } from './LayoutSwitch';
import { Pill } from './TaskCard';
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
  const auth = useAuth();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [title, setTitle] = useState(task.title);
  const [editorHtml, setEditorHtml] = useState('');
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [conflict, setConflict] = useState<TaskFull | null>(null);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  // раскладка окна и сворачивание свойств: личная настройка этого браузера, одна для всех карточек
  const [layout, setLayout] = useStored('qaflow.cardLayout', 'top', parseLayout);
  const [propsCollapsed, setPropsCollapsed] = useStored('qaflow.cardPropsCollapsed', false, (raw) => raw === 'true');
  const [actionError, setActionError] = useState<string | null>(null);

  const member = auth.state.status === 'ready' ? auth.state.member : null;
  const collabUserId = member?.user_id ?? null;
  const collabUserName = member?.display_name ?? null;
  const collabUser = useMemo(
    () =>
      collabUserId && collabUserName
        ? { id: collabUserId, name: collabUserName, color: colorForUser(collabUserId) }
        : null,
    [collabUserId, collabUserName],
  );
  // общий документ описания: правки сливаются у всех, кто открыл эту карточку
  const collab = useCollabDoc({
    id: task.id,
    html: load.kind === 'ready' ? editorHtml : null,
    user: collabUser,
    enabled: load.kind === 'ready',
  });

  // значения, известные серверу на момент последнего успешного сохранения или загрузки
  const version = useRef(task.version);
  const baseTitle = useRef(task.title);
  // то, что сейчас в редакторе описания
  const htmlRef = useRef('');
  // последний сохранённый снимок описания: повторно тот же HTML не пишем
  const snapshotHtml = useRef('');
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
        htmlRef.current = full.description_html;
        snapshotHtml.current = full.description_html;
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

  async function applyTitle(value: string) {
    const saved = await actions.saveTask(boardId, task.id, { title: value }, version.current);
    version.current = saved.version;
    baseTitle.current = value;
  }

  function persistTitle(value: string): Promise<void> {
    return enqueue(async () => {
      try {
        await applyTitle(value);
      } catch (e) {
        if (!(e instanceof api.ConflictError)) throw e;
        const fresh = await api.getTaskFull(task.id);
        if (!fresh) throw new Error('Карточку удалили, пока она была открыта.');
        if (fresh.title === baseTitle.current) {
          // менялось только положение карточки или описание: это не конфликт названий
          version.current = fresh.version;
          await applyTitle(value);
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
      await track('title', persistTitle(value));
      return true;
    } catch {
      return false;
    }
  }

  /** Сохраняет только HTML-снимок описания для поиска и экспорта; сам текст уже сведён через Yjs. */
  async function flushDescription(): Promise<boolean> {
    window.clearTimeout(descTimer.current);
    if (!descDirty.current) return true;
    let clean = sanitizeHtml(htmlRef.current);
    if (isHtmlEmpty(clean)) clean = '';
    if (clean === snapshotHtml.current) {
      descDirty.current = false;
      return true;
    }
    descDirty.current = false;
    try {
      await track('desc', actions.saveDescription(boardId, task.id, clean));
      snapshotHtml.current = clean;
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
    failed.current.clear();
    setTitle(conflict.title);
    setConflict(null);
    setStatus({ kind: 'saved' });
  }

  async function overwriteWithMine() {
    if (!conflict) return;
    version.current = conflict.version;
    baseTitle.current = conflict.title;
    failed.current.clear();
    setConflict(null);
    await saveTitle();
  }

  // ------------------------------------------------------------ архив и корзина
  /** Сначала сохраняем введённое: карточку не уносим в архив или корзину с несохранёнными правками. */
  async function leaveWith(action: () => Promise<void>) {
    const titleOk = await saveTitle();
    const descOk = await flushDescription();
    await collab.flush();
    await Promise.allSettled([...pending.current]);
    if (!titleOk || !descOk || failed.current.size > 0) {
      setCloseBlocked(true);
      throw new Error('Есть несохранённые изменения. Исправь ошибку выше или закрой окно без сохранения.');
    }
    await action();
    onClose();
  }

  async function archiveNow() {
    setActionError(null);
    try {
      await leaveWith(() => actions.archiveTask(task.id));
    } catch (e) {
      setActionError(errText(e));
    }
  }

  // ------------------------------------------------------------ закрытие
  async function requestClose() {
    const titleOk = await saveTitle();
    const descOk = await flushDescription();
    await collab.flush();
    await Promise.allSettled([...pending.current]);
    if (!titleOk || !descOk || failed.current.size > 0) {
      setCloseBlocked(true);
      return;
    }
    onClose();
  }

  const valueOf = (propertyId: string) => values.find((v) => v.property_id === propertyId);
  const ready = load.kind === 'ready';

  // сводка заполненных свойств: видна в свёрнутой области, чтобы не разворачивать её ради беглого взгляда
  const optionById = new Map(options.map((o) => [o.id, o] as const));
  const summary = buildCardFields(properties, new Map(values.map((v) => [v.property_id, v] as const)), optionById);

  const statusClass = status.kind === 'saving' ? 'save-status saving' : status.kind === 'error' ? 'save-status error' : 'save-status';

  return (
    <Dialog title={`Карточка #${task.number}`} editor full={fullscreen} onClose={() => void requestClose()}>
      <header className="editor-header">
        <span className="editor-id">#{task.number}</span>
        <input
          id="taskTitle"
          className="title-field"
          placeholder="Название карточки…"
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
        <div className="header-tools">
          <LayoutSwitch value={layout} onChange={setLayout} />
          <button
            type="button"
            className="icon-btn"
            title={fullscreen ? 'Обычный размер' : 'Развернуть на весь экран'}
            aria-label={fullscreen ? 'Обычный размер' : 'Развернуть на весь экран'}
            onClick={() => setFullscreen((f) => !f)}
          >
            {fullscreen ? '⤡' : '⤢'}
          </button>
          <button type="button" className="icon-btn" title="Закрыть" aria-label="Закрыть" onClick={() => void requestClose()}>
            ✕
          </button>
        </div>
      </header>

      <div className={`editor-body layout-${layout}${propsCollapsed ? ' props-collapsed' : ''}`}>
        <section className="props-pane" aria-label="Свойства">
          <button
            type="button"
            className="props-toggle"
            aria-expanded={!propsCollapsed}
            title={propsCollapsed ? 'Развернуть свойства' : 'Свернуть свойства'}
            onClick={() => setPropsCollapsed(!propsCollapsed)}
          >
            <span className="props-chevron" aria-hidden="true">
              ▾
            </span>
            <span className="props-title">Свойства</span>
            <span className="props-summary">
              {summary.map((f) => (
                <Pill key={f.id} field={f} />
              ))}
            </span>
          </button>
          <div className="props-body">
            <div className="props-scroll">
              {properties.length > 0 ? (
                <div className="property-grid">
                  {properties.map((p) => (
                    <div key={p.id} className="property">
                      <label>{p.name}</label>
                      <div className="property-control">
                        <PropertyField
                          property={p}
                          options={options}
                          value={valueOf(p.id)}
                          // сохранения идут по очереди: следующее использует версию значения, которую оставило предыдущее
                          onSave={(raw, force) =>
                            track(`p:${p.id}`, enqueue(() => actions.setTaskValue(boardId, task.id, p, raw, force)))
                          }
                          onDiscard={() => {
                            failed.current.delete(`p:${p.id}`);
                            refreshStatus();
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted props-empty">Свойств пока нет. Их можно добавить кнопкой «⚙» над доской.</p>
              )}
            </div>
          </div>
        </section>

        <section className="text-pane" aria-label="Описание">
          <div className="text-head">
            <span>Описание</span>
            <span className="text-head-side">
              {collab.peers.length > 0 && (
                <span className="presence" aria-label="Сейчас в карточке">
                  {collab.peers.map((peer) => (
                    <span key={peer.id} className="presence-peer" title={`${peer.name} сейчас здесь`}>
                      <span className="presence-dot" style={{ background: peer.color }} />
                      {peer.name}
                    </span>
                  ))}
                </span>
              )}
              <span className="text-hint">Подробности, шаги воспроизведения, ссылки</span>
            </span>
          </div>
          {load.kind === 'loading' && <div className="muted rich-loading">Загружаем карточку…</div>}
          {load.kind === 'error' && <div className="error">{load.message}</div>}
          {ready && collab.doc && collab.provider && (
            <RichTextEditor
              html={editorHtml}
              doc={collab.doc}
              provider={collab.provider}
              user={collabUser}
              onChange={onDescriptionChange}
              onBlur={() => void flushDescription()}
            />
          )}
          {ready && (!collab.doc || !collab.provider) && collab.error && (
            <RichTextEditor
              html={editorHtml}
              onChange={onDescriptionChange}
              onBlur={() => void flushDescription()}
            />
          )}
          {ready && (!collab.doc || !collab.provider) && !collab.error && (
            <div className="muted rich-loading">Готовим совместное описание…</div>
          )}
          {collab.error && <div className="collab-warn">{collab.error}</div>}
          {conflict && (
            <div className="conflict" role="alert">
              <strong>Карточку уже изменил кто-то другой.</strong> Название на экране не сохранено, описание при этом не потеряется.
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
        </section>
      </div>

      {actionError && (
        <div className="error editor-extra" role="alert">
          {actionError}
        </div>
      )}

      <footer className="editor-footer">
        <div className={statusClass} role="status">
          {status.kind === 'idle' && 'Изменения сохраняются автоматически'}
          {status.kind === 'saving' && 'Сохраняем…'}
          {status.kind === 'saved' && 'Все изменения сохранены'}
          {status.kind === 'error' && `Не сохранено: ${status.message}`}
        </div>
        <div className="row">
          <button className="btn small" type="button" disabled={!ready} onClick={() => void archiveNow()}>
            В архив
          </button>
          <button className="btn small danger" type="button" disabled={!ready} onClick={() => setConfirmTrash(true)}>
            В корзину
          </button>
          {closeBlocked && (
            <button className="btn small" type="button" onClick={onClose}>
              Закрыть без сохранения
            </button>
          )}
          <button className="btn small primary" type="button" onClick={() => void requestClose()}>
            Готово
          </button>
        </div>
      </footer>

      {confirmTrash && (
        <ConfirmDialog
          title="Удалить карточку?"
          confirmLabel="Убрать в корзину"
          onConfirm={() => leaveWith(() => actions.trashTask(task.id))}
          onClose={() => setConfirmTrash(false)}
        >
          Карточка #{task.number} «{task.title}» уйдёт в корзину. Оттуда её можно восстановить в разделе «Архив и корзина»,
          пока не удалишь насовсем.
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
