import { useMemo, useState, type FormEvent } from 'react';
import {
  TASK_LINK_PROPERTY,
  importSummary,
  parseImportTable,
  type ImportOptions,
  type ImportResult,
  type ImportRow,
} from '../lib/importTasks';
import { PROPERTY_TYPE_LABELS } from '../lib/format';
import { useNotice } from '../lib/notice';
import { humanizeError } from '../lib/supabase';
import type { Column, Property } from '../lib/types';
import { Dialog } from './Dialog';

/**
 * Импорт карточек из таблицы Excel: две колонки — название и ссылка.
 * Название обязательно, ссылка нет. Если свойства «Ссылка на задачу» нет,
 * его можно создать здесь же; если оно другого типа — предупреждаем, что ссылки не сохранятся.
 */
export function ImportDialog({
  columns,
  properties,
  onImport,
  onClose,
}: {
  columns: Column[];
  properties: Property[];
  onImport: (columnId: string, rows: ImportRow[], options: ImportOptions) => Promise<ImportResult>;
  onClose: () => void;
}) {
  const { notify } = useNotice();
  const [text, setText] = useState('');
  const [columnId, setColumnId] = useState(columns[0]?.id ?? '');
  const [createLinkProperty, setCreateLinkProperty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseImportTable(text), [text]);
  const summary = useMemo(() => importSummary(parsed), [parsed]);

  const linkProperty = useMemo(
    () => properties.find((p) => p.name.trim().toLowerCase() === TASK_LINK_PROPERTY.toLowerCase()),
    [properties],
  );
  const hasLinks = summary.withLink > 0;
  const linkPropertyWrongType = linkProperty !== undefined && linkProperty.type !== 'url';
  const canCreateLinkProperty = linkProperty === undefined && hasLinks;
  const linksWillBeSaved = linkProperty?.type === 'url' || (canCreateLinkProperty && createLinkProperty);
  const preview = parsed.rows.slice(0, 20);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (columnId === '' || parsed.rows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onImport(columnId, parsed.rows, {
        createLinkProperty: canCreateLinkProperty ? createLinkProperty : false,
      });
      const parts = [`Импортировано карточек: ${result.created}`];
      if (result.linked > 0) parts.push(`Со ссылкой: ${result.linked}`);
      if (result.invalidLinks > 0) parts.push(`Без ссылки из-за неверного адреса: ${result.invalidLinks}`);
      if (result.linkPropertyCreated) parts.push('Создано свойство «Ссылка на задачу»');
      if (hasLinks && !result.linksSaved) parts.push('Ссылки не сохранены');
      notify(parts.join('. '));
      onClose();
    } catch (err) {
      setError(humanizeError(err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  }

  return (
    <Dialog title="Импорт карточек" wide onClose={onClose}>
      <form className="dialog-form import-form" onSubmit={submit}>
        <div className="export-grid">
          <label className="small-text muted" htmlFor="importColumn">
            Куда добавлять
            <select
              id="importColumn"
              className="field"
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
              disabled={columns.length === 0}
            >
              {columns.length === 0 && <option value="">Сначала создай колонку</option>}
              {columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="label" htmlFor="importTable">
          Таблица из Excel
        </label>
        <textarea
          id="importTable"
          className="field import-text"
          rows={7}
          spellCheck={false}
          placeholder={'Вставь две колонки: название и ссылка.\nНапример:\nПроверить вход\t https://example.com/task/1\nОбновить пароль'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="muted small-note">
          Скопируй строки в Excel и вставь сюда: колонки разделяются табуляцией. Название обязательно, ссылка — нет.
          Заголовок таблицы, если он есть, пропускается сам.
        </div>

        {parsed.headerSkipped && <div className="muted small-note">Первая строка распознана как заголовок и пропущена.</div>}

        {parsed.rows.length > 0 && (
          <div className="import-summary" role="status">
            <strong>Будет создано карточек: {summary.total}.</strong>{' '}
            {hasLinks ? `Со ссылкой: ${summary.withLink}.` : 'Все карточки без ссылок.'}
          </div>
        )}

        {parsed.rows.length === 0 && text.trim() !== '' && (
          <div className="muted small-note">В таблице не нашлось строк с названием карточки.</div>
        )}

        {parsed.skipped > 0 && (
          <div className="muted small-note">
            Пропущено строк без названия: {parsed.skipped}. Ссылку без названия сохранить некуда.
          </div>
        )}

        {hasLinks && linkProperty !== undefined && linkProperty.type !== 'url' && (
          <div className="conflict" role="alert">
            Свойство «{TASK_LINK_PROPERTY}» уже есть, но его тип — {PROPERTY_TYPE_LABELS[linkProperty.type]}. В такое
            свойство ссылку записать нельзя, поэтому карточки создадутся без ссылок. Поменяй тип свойства или
            переименуй его, чтобы освободить имя.
          </div>
        )}

        {canCreateLinkProperty && (
          <label className="check-line">
            <input
              type="checkbox"
              checked={createLinkProperty}
              onChange={(e) => setCreateLinkProperty(e.target.checked)}
            />
            Создать свойство «{TASK_LINK_PROPERTY}» и сохранить в него ссылки
          </label>
        )}

        {hasLinks && !linksWillBeSaved && !linkPropertyWrongType && (
          <div className="conflict" role="alert">
            Ссылки не сохранятся: свойства «{TASK_LINK_PROPERTY}» нет, а создавать его ты не стала. Карточки
            импортируются только с названиями.
          </div>
        )}

        {summary.invalidLinks > 0 && (
          <div className="conflict" role="alert">
            У {summary.invalidLinks} {summary.invalidLinks === 1 ? 'строки' : 'строк'} ссылка не начинается с
            http:// или https://. Эти карточки создадутся без ссылки.
          </div>
        )}

        {parsed.rows.length > 0 && (
          <div className="import-preview" aria-label="Предпросмотр импорта">
            <div className="import-preview-head">
              Что попадёт на доску
              {parsed.rows.length > preview.length && (
                <span className="muted small-text"> · показаны первые {preview.length}</span>
              )}
            </div>
            {preview.map((row) => (
              <div key={row.line} className="import-preview-row">
                <span className="import-preview-line">{row.line}</span>
                <span className="import-preview-title" title={row.title}>
                  {row.title}
                </span>
                {row.invalidLink ? (
                  <span className="import-preview-link bad" title={row.link}>
                    не ссылка
                  </span>
                ) : row.link !== '' ? (
                  <span className="import-preview-link" title={row.link}>
                    ссылка
                  </span>
                ) : (
                  <span className="import-preview-link muted">без ссылки</span>
                )}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <div className="row end">
          <button className="btn" type="button" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn primary"
            type="submit"
            disabled={busy || columnId === '' || parsed.rows.length === 0}
          >
            {busy ? 'Импортируем…' : `Импортировать${summary.total > 0 ? ` (${summary.total})` : ''}`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
