import type { Column, Property, PropertyOption, Task, TaskValue } from './types';
import { matchesFilters, sortTasks, type PropFilter, type SortSpec, type ViewContext } from './viewConfig';

/** Свежие данные доски для экспорта: включают архивные задачи и колонки, но не корзину. */
export interface ExportData {
  columns: Column[];
  tasks: Task[];
  properties: Property[]; // только активные
  options: PropertyOption[];
  values: TaskValue[];
}

export interface Selection {
  /** null = все колонки */
  columnId: string | null;
  includeArchived: boolean;
  /** Текущий вид доски: фильтры, сортировка и результат поиска. null = все задачи области. */
  view: { filters: Record<string, PropFilter>; sort: SortSpec; searchIds: ReadonlySet<string> | null } | null;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Какие задачи попадут в файл и в каком порядке: колонки слева направо, внутри колонки порядок вида
 * (или ручной порядок, если вид не применяется). Удалённые задачи (корзина) не попадают никогда.
 * Задача из архивной колонки считается архивной.
 */
export function selectTasks(data: ExportData, sel: Selection): Task[] {
  const columns = [...data.columns].sort((a, b) => cmp(a.position, b.position) || cmp(a.id, b.id));
  const archivedColumns = new Set(data.columns.filter((c) => c.archived_at !== null).map((c) => c.id));

  const properties = new Map(data.properties.filter((p) => p.archived_at === null).map((p) => [p.id, p] as const));
  const valuesByTask = new Map<string, Map<string, TaskValue>>();
  for (const v of data.values) {
    let inner = valuesByTask.get(v.task_id);
    if (!inner) valuesByTask.set(v.task_id, (inner = new Map()));
    inner.set(v.property_id, v);
  }
  const ctx: ViewContext = {
    properties,
    options: new Map(data.options.map((o) => [o.id, o] as const)),
    valuesOf: (id) => valuesByTask.get(id),
  };

  const out: Task[] = [];
  for (const column of columns) {
    if (sel.columnId !== null && column.id !== sel.columnId) continue;
    let list = data.tasks.filter((t) => {
      if (t.column_id !== column.id || t.deleted_at !== null) return false;
      return sel.includeArchived || (t.archived_at === null && !archivedColumns.has(t.column_id));
    });
    if (sel.view) {
      const { filters, searchIds } = sel.view;
      list = list.filter((t) => (searchIds === null || searchIds.has(t.id)) && matchesFilters(t, filters, ctx));
    }
    out.push(...sortTasks(list, sel.view ? sel.view.sort : { key: 'manual', dir: 'asc' }, ctx));
  }
  return out;
}
