import type { ColorName, Column, Property, PropertyOption, TaskValue } from './types';
import { selectedOptionIds } from './values';

export interface Bucket {
  key: string;
  label: string;
  count: number;
  color?: ColorName;
}

export interface PropertyStats {
  propertyId: string;
  name: string;
  buckets: Bucket[]; // варианты списка по порядку и «Не задано»
}

export interface BoardStats {
  total: number;
  byColumn: Bucket[];
  byProperty: PropertyStats[];
}

const cmp = (a: { position: string; id: string }, b: { position: string; id: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Доля в процентах, целое число; при пустой выборке 0. */
export function percentOf(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100);
}

/**
 * Статистика по переданным карточкам (все активные или только подходящие под фильтры).
 * Колонки и варианты выводятся все, даже с нулём, в том порядке, в котором они на доске.
 */
export function computeStats(input: {
  columns: Column[];
  tasks: { id: string; column_id: string }[];
  properties: Property[];
  options: PropertyOption[];
  values: TaskValue[];
}): BoardStats {
  const columns = [...input.columns].sort(cmp);
  const inColumn = new Map<string, number>(columns.map((c) => [c.id, 0] as const));
  for (const t of input.tasks) {
    if (inColumn.has(t.column_id)) inColumn.set(t.column_id, (inColumn.get(t.column_id) ?? 0) + 1);
  }
  const byColumn: Bucket[] = columns.map((c) => ({
    key: c.id,
    label: c.name,
    count: inColumn.get(c.id) ?? 0,
    color: c.color,
  }));

  const taskIds = new Set(input.tasks.map((t) => t.id));
  const optionsOf = new Map<string, string[]>(); // task|property -> выбранные варианты
  for (const v of input.values) {
    const ids = selectedOptionIds(v);
    if (ids.length > 0 && taskIds.has(v.task_id)) optionsOf.set(`${v.task_id}|${v.property_id}`, ids);
  }

  const byProperty: PropertyStats[] = input.properties
    .filter((p) => p.type === 'select' && p.archived_at === null)
    .sort(cmp)
    .map((p) => {
      const options = input.options.filter((o) => o.property_id === p.id).sort(cmp);
      const counts = new Map<string, number>(options.map((o) => [o.id, 0] as const));
      let empty = 0;
      for (const t of input.tasks) {
        const selected = optionsOf.get(`${t.id}|${p.id}`) ?? [];
        let found = false;
        for (const optionId of selected) {
          if (!counts.has(optionId)) continue;
          counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
          found = true;
        }
        if (!found) empty++;
      }
      const buckets: Bucket[] = options.map((o) => ({ key: o.id, label: o.label, count: counts.get(o.id) ?? 0, color: o.color }));
      buckets.push({ key: `${p.id}:empty`, label: 'Не задано', count: empty });
      return { propertyId: p.id, name: p.name, buckets };
    });

  return { total: input.tasks.length, byColumn, byProperty };
}
