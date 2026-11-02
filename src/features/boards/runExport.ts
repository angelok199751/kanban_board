import { buildTable, exportFileName, pickAndOrder, type ExportField } from '../../lib/export';
import { buildCsv, buildXlsx } from '../../lib/xlsx';
import { matchesFilters, type ViewConfig, type ViewContext } from '../../lib/viewConfig';
import * as api from './api';

export interface ExportRequest {
  boardId: string;
  boardName: string;
  columnId: string | null; // null: все колонки
  columnName: string | null;
  fields: ExportField[]; // выбранные столбцы в нужном порядке
  onlyFiltered: boolean; // только карточки, подходящие под текущие фильтры и поиск
  config: ViewConfig;
  search: string;
  includeArchived: boolean;
  includeDeleted: boolean;
  format: 'xlsx' | 'csv';
  delimiter: ',' | ';';
}

export interface ExportResult {
  rows: number;
  fileName: string;
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Читает актуальные данные из базы, собирает таблицу и скачивает файл. */
export async function runExport(req: ExportRequest): Promise<ExportResult> {
  const data = await api.getExportData(req.boardId, {
    includeArchived: req.includeArchived,
    includeDeleted: req.includeDeleted,
  });

  const activeProperties = new Map(data.properties.filter((p) => p.archived_at === null).map((p) => [p.id, p] as const));
  const valuesByTask = new Map<string, Map<string, (typeof data.values)[number]>>();
  for (const v of data.values) {
    let inner = valuesByTask.get(v.task_id);
    if (!inner) {
      inner = new Map();
      valuesByTask.set(v.task_id, inner);
    }
    inner.set(v.property_id, v);
  }
  const ctx: ViewContext = {
    properties: activeProperties,
    options: new Map(data.options.map((o) => [o.id, o] as const)),
    valuesOf: (id) => valuesByTask.get(id),
  };

  // Столбцы, чьё свойство уже удалили в архив или убрали, пока окно было открыто, в файл не попадают
  const fields = req.fields.filter((f) => f.propertyId === undefined || activeProperties.has(f.propertyId));
  if (fields.length === 0) throw new Error('Нет столбцов для выгрузки: выбери хотя бы одно поле.');

  let keep: ((t: { id: string }) => boolean) | null = null;
  if (req.onlyFiltered) {
    const q = req.search.trim();
    let searchIds: Set<string> | null = null;
    if (q !== '') {
      searchIds = new Set(await api.searchTaskIds(req.boardId, q));
      const asNumber = q.replace(/^#/, '');
      if (/^\d+$/.test(asNumber)) for (const t of data.tasks) if (String(t.number) === asNumber) searchIds.add(t.id);
    }
    keep = (t) => (searchIds === null || searchIds.has(t.id)) && matchesFilters(t, req.config.filters, ctx);
  }

  const picked = pickAndOrder(data.tasks, data.columns, {
    columnId: req.columnId,
    keep,
    sort: req.config.sort,
    ctx,
  });
  if (picked.length === 0) throw new Error('По выбранным условиям карточек нет: файл не создан.');

  const table = buildTable(picked, fields, { columns: data.columns, options: data.options, values: data.values });
  const fileName = exportFileName(req.boardName, req.columnName ?? 'все колонки', req.format, new Date());

  if (req.format === 'xlsx') {
    const bytes = buildXlsx(table, req.boardName);
    // bytes занимает весь свой буфер (zip создаёт его целиком), поэтому передаём буфер как есть
    download(
      new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      fileName,
    );
  } else {
    // BOM в начале, чтобы Excel правильно определил кодировку UTF-8
    download(new Blob(['\uFEFF', buildCsv(table, req.delimiter)], { type: 'text/csv;charset=utf-8' }), fileName);
  }
  return { rows: picked.length, fileName };
}
