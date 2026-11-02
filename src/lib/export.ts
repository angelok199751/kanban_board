import type { Column, ExportTask, Property, PropertyOption, PropertyType, TaskValue } from './types';
import { selectedOptionIds } from './values';
import { sortTasks, type SortSpec, type ViewContext } from './viewConfig';
import type { Cell, Table } from './xlsx';

export type SystemFieldId = 'number' | 'title' | 'column' | 'description' | 'state';

/** Столбец экспорта: служебное поле карточки или свойство доски. */
export interface ExportField {
  id: string; // 'number' | 'title' | ... | id свойства
  label: string; // заголовок столбца
  kind: SystemFieldId | PropertyType;
  propertyId?: string;
}

export interface ExportSource {
  columns: Column[];
  options: PropertyOption[];
  values: TaskValue[];
}

export const SYSTEM_FIELDS: ExportField[] = [
  { id: 'number', label: '№', kind: 'number' },
  { id: 'title', label: 'Название', kind: 'title' },
  { id: 'column', label: 'Колонка', kind: 'column' },
  { id: 'description', label: 'Описание', kind: 'description' },
  { id: 'state', label: 'Состояние', kind: 'state' },
];

/** Поля, включённые по умолчанию; остальные служебные поля можно добавить вручную. */
export const DEFAULT_ON = new Set(['number', 'title', 'column']);

export function propertyField(p: Property): ExportField {
  return { id: p.id, label: p.name, kind: p.type, propertyId: p.id };
}

/** Описание карточки (HTML редактора) в обычный текст: абзацы и пункты списков превращаются в строки. */
export function htmlToText(html: string): string {
  if (html.trim() === '') return '';
  return html
    .replace(/\r?\n/g, ' ') // переводы строк внутри разметки не значимы
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(p|div|li|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Таблица для файла: одна карточка = одна строка, выбранные поля = столбцы в заданном порядке. */
export function buildTable(tasks: ExportTask[], fields: ExportField[], src: ExportSource): Table {
  const columnName = new Map(src.columns.map((c) => [c.id, c.name] as const));
  const optionLabel = new Map(src.options.map((o) => [o.id, o.label] as const));
  const valuesByTask = new Map<string, Map<string, TaskValue>>();
  for (const v of src.values) {
    let inner = valuesByTask.get(v.task_id);
    if (!inner) {
      inner = new Map<string, TaskValue>();
      valuesByTask.set(v.task_id, inner);
    }
    inner.set(v.property_id, v);
  }

  const cell = (t: ExportTask, f: ExportField): Cell => {
    switch (f.kind) {
      case 'number':
        return t.number;
      case 'title':
        return t.title;
      case 'column':
        return columnName.get(t.column_id) ?? '';
      case 'description': {
        const text = htmlToText(t.description_html);
        return text === '' ? null : text;
      }
      case 'state':
        return t.deleted_at ? 'Удалена' : t.archived_at ? 'В архиве' : 'Активна';
      default: {
        const v = f.propertyId ? valuesByTask.get(t.id)?.get(f.propertyId) : undefined;
        if (!v) return null;
        if (f.kind === 'select') {
          const labels = selectedOptionIds(v)
            .map((id) => optionLabel.get(id))
            .filter((label): label is string => label !== undefined);
          return labels.length > 0 ? labels.join(', ') : null;
        }
        if (f.kind === 'date') return v.value_date ? { date: v.value_date } : null;
        return v.value_text ?? null; // текст и ссылка (URL как есть)
      }
    }
  };

  return {
    header: fields.map((f) => f.label),
    rows: tasks.map((t) => fields.map((f) => cell(t, f))),
  };
}

/**
 * Какие карточки попадут в файл и в каком порядке: колонки в порядке доски,
 * внутри колонки порядок как в выбранной сортировке (по умолчанию как на доске).
 */
export function pickAndOrder(
  tasks: ExportTask[],
  columns: Column[],
  opts: { columnId: string | null; keep: ((t: ExportTask) => boolean) | null; sort: SortSpec; ctx: ViewContext },
): ExportTask[] {
  const ordered = [...columns].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1));
  const out: ExportTask[] = [];
  for (const column of ordered) {
    if (opts.columnId !== null && column.id !== opts.columnId) continue;
    const inColumn = tasks.filter((t) => t.column_id === column.id && (opts.keep === null || opts.keep(t)));
    out.push(...sortTasks(inColumn, opts.sort, opts.ctx));
  }
  return out;
}

const cleanPart = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 40);

/** Имя файла: доска, область, дата выгрузки. */
export function exportFileName(board: string, scope: string, ext: 'xlsx' | 'csv', today: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return `${cleanPart(board) || 'доска'}_${cleanPart(scope) || 'все'}_${date}.${ext}`;
}
