import { useEffect, useMemo, useRef, useState } from 'react';
import { useBoardData } from '../features/boards/hooks';
import { runExport, type ExportResult } from '../features/boards/runExport';
import { DEFAULT_ON, propertyField, SYSTEM_FIELDS, type ExportField } from '../lib/export';
import { PROPERTY_TYPE_LABELS, plural } from '../lib/format';
import { compareByPosition } from '../lib/positions';
import { humanizeError } from '../lib/supabase';
import type { Board } from '../lib/types';
import type { ViewConfig } from '../lib/viewConfig';
import { Dialog } from './Dialog';

interface FieldRow {
  field: ExportField;
  checked: boolean;
}

const KIND_HINT: Record<string, string> = {
  number: 'служебное',
  title: 'служебное',
  column: 'служебное',
  description: 'служебное, обычный текст',
  state: 'служебное: активна, в архиве, удалена',
  select: PROPERTY_TYPE_LABELS.select,
  text: PROPERTY_TYPE_LABELS.text,
  url: PROPERTY_TYPE_LABELS.url,
  date: PROPERTY_TYPE_LABELS.date,
};

/**
 * Экран настройки экспорта: доска, колонка, набор и порядок столбцов, фильтры, архив, формат.
 * Данные для файла берутся из базы в момент нажатия кнопки, а не из того, что сейчас на экране.
 */
export function ExportDialog({
  boards,
  currentBoardId,
  config,
  search,
  onClose,
}: {
  boards: Board[];
  currentBoardId: string;
  config: ViewConfig;
  search: string;
  onClose: () => void;
}) {
  const [boardId, setBoardId] = useState(currentBoardId);
  const [columnId, setColumnId] = useState('');
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [onlyFiltered, setOnlyFiltered] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [delimiter, setDelimiter] = useState<';' | ','>(';');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);

  const board = boards.find((b) => b.id === boardId) ?? boards[0];
  const query = useBoardData(boardId);
  const columns = useMemo(() => [...(query.data?.columns ?? [])].sort(compareByPosition), [query.data]);

  // Набор столбцов собираем один раз для каждой выбранной доски, чтобы фоновое обновление данных не сбивало настройки
  const initializedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!query.data || initializedFor.current === boardId) return;
    initializedFor.current = boardId;
    setColumnId('');
    const properties = query.data.properties.filter((p) => p.archived_at === null).sort(compareByPosition);
    setRows([
      ...SYSTEM_FIELDS.map((f) => ({ field: f, checked: DEFAULT_ON.has(f.id) })),
      ...properties.map((p) => ({ field: propertyField(p), checked: true })),
    ]);
  }, [boardId, query.data]);

  const filtersAvailable = boardId === currentBoardId && (Object.keys(config.filters).length > 0 || search.trim() !== '');
  const useFilters = onlyFiltered && filtersAvailable;
  const selected = rows.filter((r) => r.checked);
  const columnName = columnId ? (columns.find((c) => c.id === columnId)?.name ?? null) : null;

  const toggle = (i: number) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, checked: !r.checked } : r)));
  const setAll = (checked: boolean) => setRows((rs) => rs.map((r) => ({ ...r, checked })));
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  async function doExport() {
    if (!board) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await runExport({
        boardId,
        boardName: board.name,
        columnId: columnId === '' ? null : columnId,
        columnName,
        fields: selected.map((r) => r.field),
        onlyFiltered: useFilters,
        config,
        search,
        includeArchived,
        includeDeleted,
        format,
        delimiter,
      });
      setResult(res);
    } catch (e) {
      setError(humanizeError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Экспорт" wide extraClass="export-dialog" onClose={onClose}>
      <p className="export-intro muted small-text">
        Файл собирается из актуальных данных базы в момент скачивания. Ниже — только настройки выгрузки.
      </p>

      <section className="export-section export-card">
        <div className="export-section-head">
          <span className="export-step" aria-hidden="true">
            1
          </span>
          <div className="export-section-title">
            <div className="label">Что выгружать</div>
            <div className="muted small-note">Доска и колонка</div>
          </div>
          <span className="export-pill">{columnName ?? 'Все колонки'}</span>
        </div>

        <div className="export-grid">
          <label className="small-text muted">
            Доска
            <select className="field" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="small-text muted">
            Колонка
            <select className="field" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
              <option value="">Все колонки</option>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="export-checks">
          <label className={filtersAvailable ? 'check-line' : 'check-line disabled'}>
            <input type="checkbox" checked={useFilters} disabled={!filtersAvailable} onChange={(e) => setOnlyFiltered(e.target.checked)} />
            Только карточки по текущим фильтрам и поиску
          </label>
          <label className="check-line">
            <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
            Включить архивные карточки
          </label>
          <label className="check-line">
            <input type="checkbox" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} />
            Включить удалённые карточки (корзина)
          </label>
        </div>
        {!filtersAvailable && (
          <div className="muted small-note">
            {boardId === currentBoardId ? 'Сейчас фильтры и поиск не заданы: выгрузятся все карточки области.' : 'Фильтры относятся к открытой доске.'}
          </div>
        )}
      </section>

      <section className="export-section export-card">
        <div className="export-fields-head">
          <div className="export-section-title">
            <div className="label">Столбцы и их порядок</div>
            <div className="muted small-note">
              Выбрано {selected.length} из {rows.length}
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn small" onClick={() => setAll(true)}>
              Выбрать все
            </button>
            <button type="button" className="btn small" onClick={() => setAll(false)}>
              Снять все
            </button>
          </div>
        </div>
        {query.isLoading && <div className="muted">Загружаем список полей…</div>}
        <div className="export-fields">
          {rows.map((r, i) => (
            <div key={r.field.id} className={r.checked ? 'export-field-row' : 'export-field-row off'}>
              <input type="checkbox" checked={r.checked} aria-label={`Выгружать: ${r.field.label}`} onChange={() => toggle(i)} />
              <span className="export-field-name">{r.field.label}</span>
              <span className="type-badge">{KIND_HINT[r.field.kind]}</span>
              <button type="button" className="icon-btn" title="Выше" aria-label="Выше" disabled={i === 0} onClick={() => move(i, -1)}>
                ▲
              </button>
              <button type="button" className="icon-btn" title="Ниже" aria-label="Ниже" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                ▼
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="export-section export-card">
        <div className="export-section-head">
          <span className="export-step" aria-hidden="true">
            2
          </span>
          <div className="export-section-title">
            <div className="label">Формат</div>
            <div className="muted small-note">Excel удобнее для дат и списков, CSV — для обмена</div>
          </div>
          <span className="export-pill">{format.toUpperCase()}</span>
        </div>

        <div className="export-grid">
          <label className="small-text muted">
            Файл
            <select className="field" value={format} onChange={(e) => setFormat(e.target.value as 'xlsx' | 'csv')}>
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV (.csv)</option>
            </select>
          </label>
          {format === 'csv' && (
            <label className="small-text muted">
              Разделитель
              <select className="field" value={delimiter} onChange={(e) => setDelimiter(e.target.value as ';' | ',')}>
                <option value=";">Точка с запятой (для русского Excel)</option>
                <option value=",">Запятая</option>
              </select>
            </label>
          )}
        </div>
        <div className="muted small-note">
          Даты в Excel записываются настоящими датами, в CSV как ГГГГ-ММ-ДД. Выпадающие списки выгружаются названием варианта,
          ссылки адресом.
        </div>
      </section>

      <div className="export-summary" role="status">
        <strong>Будет выгружено:</strong> доска «{board?.name ?? '—'}», {columnName ? `колонка «${columnName}»` : 'все колонки'},
        {useFilters ? ' только по текущим фильтрам и поиску,' : ' все карточки области,'}
        {includeArchived ? ' с архивными,' : ''}
        {includeDeleted ? ' с удалёнными,' : ''} {selected.length} {plural(selected.length, 'столбец', 'столбца', 'столбцов')}.
        {selected.length > 0 && (
          <div className="export-summary-fields">
            {selected.map((r) => (
              <span key={r.field.id} className="export-summary-chip">
                {r.field.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="success" role="status">
          Готово: {result.rows} {plural(result.rows, 'карточка', 'карточки', 'карточек')}. Файл «{result.fileName}» сохранён в загрузки браузера.
        </div>
      )}

      <div className="row end export-actions">
        <button className="btn" type="button" onClick={onClose}>
          Закрыть
        </button>
        <button className="btn primary" type="button" disabled={busy || query.isLoading || selected.length === 0} onClick={() => void doExport()}>
          {busy ? 'Готовим файл…' : 'Скачать файл'}
        </button>
      </div>
    </Dialog>
  );
}
