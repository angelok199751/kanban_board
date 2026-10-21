import type { Property, PropertyOption, Task, TaskValue } from './types';

/** Условие фильтра по одному свойству. Какие поля используются, зависит от типа свойства. */
export interface PropFilter {
  optionIds?: string[]; // список: любой из выбранных вариантов
  empty?: boolean; // список: «не задано»
  contains?: string; // текст и ссылка: содержит
  from?: string; // дата: с (включительно), 'YYYY-MM-DD'
  to?: string; // дата: по (включительно)
}

export interface SortSpec {
  key: string; // 'manual' | 'number' | 'title' | id свойства
  dir: 'asc' | 'desc';
}

/** Что сохраняется в представлении: фильтры, сортировка, вид карточек. Поиск в представление не входит. */
export interface ViewConfig {
  filters: Record<string, PropFilter>;
  sort: SortSpec;
  compact: boolean;
  cardProps: string[] | null; // какие свойства показывать на карточке; null — как настроено в «Свойствах»
}

export const DEFAULT_CONFIG: ViewConfig = {
  filters: {},
  sort: { key: 'manual', dir: 'asc' },
  compact: false,
  cardProps: null,
};

export function isFilterActive(f: PropFilter): boolean {
  return (
    (f.optionIds !== undefined && f.optionIds.length > 0) ||
    f.empty === true ||
    (f.contains !== undefined && f.contains.trim() !== '') ||
    (f.from !== undefined && f.from !== '') ||
    (f.to !== undefined && f.to !== '')
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Приводит сохранённый или недостоверный JSON к корректной конфигурации (порядок ключей стабилен). */
export function normalizeConfig(raw: unknown): ViewConfig {
  if (!isRecord(raw)) return { ...DEFAULT_CONFIG, filters: {} };

  const filters: Record<string, PropFilter> = {};
  const rawFilters = isRecord(raw.filters) ? raw.filters : {};
  for (const id of Object.keys(rawFilters).sort()) {
    const f = rawFilters[id];
    if (!isRecord(f)) continue;
    const clean: PropFilter = {};
    const ids = strings(f.optionIds).sort();
    if (ids.length > 0) clean.optionIds = ids;
    if (f.empty === true) clean.empty = true;
    if (typeof f.contains === 'string' && f.contains.trim() !== '') clean.contains = f.contains;
    if (typeof f.from === 'string' && f.from !== '') clean.from = f.from;
    if (typeof f.to === 'string' && f.to !== '') clean.to = f.to;
    if (isFilterActive(clean)) filters[id] = clean;
  }

  const rawSort = isRecord(raw.sort) ? raw.sort : {};
  const sort: SortSpec = {
    key: typeof rawSort.key === 'string' && rawSort.key !== '' ? rawSort.key : 'manual',
    dir: rawSort.dir === 'desc' ? 'desc' : 'asc',
  };

  return {
    filters,
    sort,
    compact: raw.compact === true,
    cardProps: Array.isArray(raw.cardProps) ? strings(raw.cardProps) : null,
  };
}

export const sameConfig = (a: ViewConfig, b: ViewConfig): boolean =>
  JSON.stringify(normalizeConfig(a)) === JSON.stringify(normalizeConfig(b));

/** Сколько фильтров реально действует (по существующим свойствам). */
export function countActiveFilters(config: ViewConfig, properties: Map<string, Property>): number {
  return Object.entries(config.filters).filter(([id, f]) => properties.has(id) && isFilterActive(f)).length;
}

export function isShownOnCard(property: Property, config: ViewConfig): boolean {
  return config.cardProps ? config.cardProps.includes(property.id) : !property.hidden;
}

// ---------------------------------------------------------------- применение к карточкам

export interface ViewContext {
  properties: Map<string, Property>; // активные свойства доски
  options: Map<string, PropertyOption>;
  valuesOf: (taskId: string) => Map<string, TaskValue> | undefined;
}

/** Все фильтры должны выполняться одновременно. Фильтры по удалённым или архивным свойствам не действуют. */
export function matchesFilters(task: Task, filters: Record<string, PropFilter>, ctx: ViewContext): boolean {
  for (const [propertyId, f] of Object.entries(filters)) {
    const property = ctx.properties.get(propertyId);
    if (!property || !isFilterActive(f)) continue;
    const v = ctx.valuesOf(task.id)?.get(propertyId);

    if (property.type === 'select') {
      const wanted = f.optionIds ?? [];
      const has = v !== undefined && v.option_id !== null;
      const ok = (has && wanted.includes(v.option_id as string)) || (!has && f.empty === true);
      if (!ok) return false;
    } else if (property.type === 'date') {
      const d = v?.value_date ?? null;
      if (d === null) return false;
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
    } else {
      const needle = (f.contains ?? '').trim().toLowerCase();
      if (needle === '') continue;
      if (!(v?.value_text ?? '').toLowerCase().includes(needle)) return false;
    }
  }
  return true;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byPosition = (a: Task, b: Task) => cmpStr(a.position, b.position) || cmpStr(a.id, b.id);

/** Сортировка карточек. «Вручную» это порядок по position. Пустые значения всегда в конце. */
export function sortTasks(tasks: Task[], sort: SortSpec, ctx: ViewContext): Task[] {
  const list = [...tasks];
  if (sort.key === 'manual') return list.sort(byPosition);

  const sign = sort.dir === 'desc' ? -1 : 1;

  if (sort.key === 'number') return list.sort((a, b) => sign * (a.number - b.number));
  if (sort.key === 'title') {
    return list.sort(
      (a, b) =>
        sign * a.title.localeCompare(b.title, 'ru', { sensitivity: 'base', numeric: true }) || a.number - b.number,
    );
  }

  const property = ctx.properties.get(sort.key);
  if (!property) return list.sort(byPosition); // свойство удалено: возвращаемся к ручному порядку

  const keyOf = (t: Task): string | null => {
    const v = ctx.valuesOf(t.id)?.get(property.id);
    if (!v) return null;
    if (property.type === 'select') return v.option_id ? (ctx.options.get(v.option_id)?.position ?? null) : null;
    if (property.type === 'date') return v.value_date;
    return v.value_text ? v.value_text.toLowerCase() : null;
  };

  return list.sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === null && kb === null) return a.number - b.number;
    if (ka === null) return 1; // пустые в конце при любом направлении
    if (kb === null) return -1;
    return sign * cmpStr(ka, kb) || a.number - b.number;
  });
}
