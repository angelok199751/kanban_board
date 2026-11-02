import { useEffect, useRef, useState } from 'react';
import * as api from '../features/boards/api';
import { useActions } from '../features/boards/hooks';
import { labelsToText, parseLabels, sameLabels } from '../lib/labels';
import { isHtmlEmpty, sanitizeHtml } from '../lib/sanitize';
import { humanizeError } from '../lib/supabase';
import type { ArticleFull } from '../lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { RichTextEditor } from './RichTextEditor';

type SaveStatus = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };
type LoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

const errText = (e: unknown) => humanizeError(e instanceof Error ? e.message : String(e));
const DESCRIPTION_DELAY_MS = 1500;

/**
 * Окно статьи: заголовок, метки и текст. Работает так же, как окно карточки:
 * всё сохраняется само, окно не закрывается молча, пока есть несохранённая ошибка,
 * сохранение идёт «если версия не изменилась», а при чужой правке предлагается выбор.
 */
export function ArticleDialog({
  baseId,
  articleId,
  initialTitle,
  onClose,
}: {
  baseId: string;
  articleId: string;
  initialTitle: string;
  onClose: () => void;
}) {
  const actions = useActions();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [title, setTitle] = useState(initialTitle);
  const [labelsText, setLabelsText] = useState('');
  const [editorHtml, setEditorHtml] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [conflict, setConflict] = useState<ArticleFull | null>(null);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // значения, известные серверу на момент последнего успешного сохранения или загрузки
  const version = useRef(0);
  const baseTitle = useRef(initialTitle);
  const baseLabels = useRef<string[]>([]);
  const baseHtml = useRef('');
  const htmlRef = useRef('');
  const htmlDirty = useRef(false);
  const htmlTimer = useRef<number | undefined>(undefined);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(new Set<Promise<unknown>>());
  const failed = useRef(new Map<string, string>());

  // ------------------------------------------------------------ загрузка свежей статьи
  useEffect(() => {
    let cancelled = false;
    api
      .getArticleFull(articleId)
      .then((full) => {
        if (cancelled) return;
        if (!full) {
          setLoad({ kind: 'error', message: 'Статья не найдена: возможно, её удалили.' });
          return;
        }
        version.current = full.version;
        baseTitle.current = full.title;
        baseLabels.current = full.labels;
        baseHtml.current = full.content_html;
        htmlRef.current = full.content_html;
        setTitle(full.title);
        setLabelsText(labelsToText(full.labels));
        setEditorHtml(full.content_html);
        setLoad({ kind: 'ready' });
      })
      .catch((e) => {
        if (!cancelled) setLoad({ kind: 'error', message: errText(e) });
      });
    return () => {
      cancelled = true;
      window.clearTimeout(htmlTimer.current);
    };
  }, [articleId]);

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

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.current.then(fn, fn);
    queue.current = run.catch(() => undefined);
    return run;
  }

  type Patch = { title?: string; labels?: string[]; content_html?: string };

  async function apply(patch: Patch) {
    const saved = await actions.saveArticle(baseId, articleId, patch, version.current);
    version.current = saved.version;
    if (patch.title !== undefined) baseTitle.current = patch.title;
    if (patch.labels !== undefined) baseLabels.current = patch.labels;
    if (patch.content_html !== undefined) baseHtml.current = patch.content_html;
  }

  function persist(patch: Patch): Promise<void> {
    return enqueue(async () => {
      try {
        await apply(patch);
      } catch (e) {
        if (!(e instanceof api.ConflictError)) throw e;
        const fresh = await api.getArticleFull(articleId);
        if (!fresh) throw new Error('Статью удалили, пока она была открыта.');
        const unchanged =
          fresh.title === baseTitle.current &&
          sameLabels(fresh.labels, baseLabels.current) &&
          fresh.content_html === baseHtml.current;
        if (unchanged) {
          // содержимое то же, разошлась только версия: берём новую и сохраняем
          version.current = fresh.version;
          await apply(patch);
          return;
        }
        setConflict(fresh);
        throw e;
      }
    });
  }

  // ------------------------------------------------------------ поля
  async function flushFields(): Promise<boolean> {
    if (load.kind !== 'ready') return true;
    const patch: Patch = {};
    const value = title.trim();
    if (value === '') setTitle(baseTitle.current); // пустой заголовок не сохраняем
    else if (value !== baseTitle.current) patch.title = value;

    const labels = parseLabels(labelsText);
    if (!sameLabels(labels, baseLabels.current)) patch.labels = labels;
    setLabelsText(labelsToText(labels));

    if (Object.keys(patch).length === 0) return true;
    try {
      await track('fields', persist(patch));
      return true;
    } catch {
      return false;
    }
  }

  async function flushContent(): Promise<boolean> {
    window.clearTimeout(htmlTimer.current);
    if (!htmlDirty.current) return true;
    let clean = sanitizeHtml(htmlRef.current);
    if (isHtmlEmpty(clean)) clean = '';
    if (clean === baseHtml.current) {
      htmlDirty.current = false;
      return true;
    }
    htmlDirty.current = false;
    try {
      await track('content', persist({ content_html: clean }));
      return true;
    } catch {
      htmlDirty.current = true;
      return false;
    }
  }

  function onContentChange(html: string) {
    htmlRef.current = html;
    htmlDirty.current = true;
    window.clearTimeout(htmlTimer.current);
    htmlTimer.current = window.setTimeout(() => void flushContent(), DESCRIPTION_DELAY_MS);
  }

  // ------------------------------------------------------------ конфликт
  function loadFresh() {
    if (!conflict) return;
    version.current = conflict.version;
    baseTitle.current = conflict.title;
    baseLabels.current = conflict.labels;
    baseHtml.current = conflict.content_html;
    htmlRef.current = conflict.content_html;
    htmlDirty.current = false;
    failed.current.clear();
    setTitle(conflict.title);
    setLabelsText(labelsToText(conflict.labels));
    setEditorHtml(conflict.content_html);
    setEditorKey((k) => k + 1);
    setConflict(null);
    setStatus({ kind: 'saved' });
  }

  async function overwriteWithMine() {
    if (!conflict) return;
    version.current = conflict.version;
    baseTitle.current = conflict.title;
    baseLabels.current = conflict.labels;
    baseHtml.current = conflict.content_html;
    failed.current.clear();
    setConflict(null);
    await flushFields();
    htmlDirty.current = true;
    await flushContent();
  }

  // ------------------------------------------------------------ корзина и закрытие
  async function saveEverything(): Promise<boolean> {
    const fieldsOk = await flushFields();
    const contentOk = await flushContent();
    await Promise.allSettled([...pending.current]);
    return fieldsOk && contentOk && failed.current.size === 0;
  }

  async function leaveWith(action: () => Promise<void>) {
    if (!(await saveEverything())) {
      setCloseBlocked(true);
      throw new Error('Есть несохранённые изменения. Исправь ошибку выше или закрой окно без сохранения.');
    }
    await action();
    onClose();
  }

  async function requestClose() {
    if (!(await saveEverything())) {
      setCloseBlocked(true);
      return;
    }
    onClose();
  }

  const ready = load.kind === 'ready';
  const statusClass = status.kind === 'saving' ? 'save-status saving' : status.kind === 'error' ? 'save-status error' : 'save-status';

  return (
    <Dialog title="Статья" editor full={fullscreen} onClose={() => void requestClose()}>
      <header className="editor-header">
        <span className="editor-id">Статья</span>
        <input
          id="articleTitle"
          className="title-field"
          placeholder="Заголовок статьи…"
          maxLength={300}
          autoFocus
          value={title}
          disabled={!ready}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void flushFields()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <div className="header-tools">
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

      <div className="article-body">
        <div className="property article-labels">
          <label htmlFor="articleLabels">Метки</label>
          <input
            id="articleLabels"
            className="field"
            placeholder="через запятую, например: релиз, чек-лист"
            disabled={!ready}
            value={labelsText}
            onChange={(e) => setLabelsText(e.target.value)}
            onBlur={() => void flushFields()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </div>

        <section className="text-pane" aria-label="Текст статьи">
          <div className="text-head">
            <span>Текст</span>
          </div>
          {load.kind === 'loading' && <div className="muted rich-loading">Загружаем статью…</div>}
          {load.kind === 'error' && <div className="error">{load.message}</div>}
          {ready && <RichTextEditor key={editorKey} html={editorHtml} onChange={onContentChange} onBlur={() => void flushContent()} />}
          {conflict && (
            <div className="conflict" role="alert">
              <strong>Статью уже изменил кто-то другой.</strong> То, что ты написала, осталось на экране и пока не сохранено.
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
          title="Удалить статью?"
          confirmLabel="Убрать в корзину"
          onConfirm={() => {
            setActionError(null);
            return leaveWith(() => actions.trashArticle(articleId));
          }}
          onClose={() => setConfirmTrash(false)}
        >
          Статья «{title}» уйдёт в корзину. Оттуда её можно восстановить в разделе «Архив и корзина», вкладка «Знания»,
          пока не удалишь насовсем.
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
