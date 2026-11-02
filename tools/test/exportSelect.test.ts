// Тесты выбора задач для экспорта (src/lib/exportSelect.ts). Запуск: npx tsx --test tools/test/exportSelect.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectTasks, type ExportData } from '../../src/lib/exportSelect.ts';

const col = (id: string, position: string, archived = false) => ({
  id, board_id: 'b', name: id, color: 'gray' as const, position, archived_at: archived ? '2026-01-01' : null,
});
const task = (id: string, number: number, column_id: string, position: string, extra: Partial<{ archived_at: string; deleted_at: string; title: string }> = {}) => ({
  id, board_id: 'b', column_id, number, title: extra.title ?? id, position, version: 1,
  archived_at: extra.archived_at ?? null, deleted_at: extra.deleted_at ?? null,
});

const data: ExportData = {
  columns: [col('c2', 'b'), col('c1', 'a'), col('c3', 'c', true)],
  tasks: [
    task('t1', 1, 'c1', 'b'), task('t2', 2, 'c1', 'a'), task('t3', 3, 'c2', 'a'),
    task('t4', 4, 'c1', 'c', { archived_at: '2026-02-01' }),
    task('t5', 5, 'c1', 'd', { deleted_at: '2026-02-02' }),
    task('t6', 6, 'c3', 'a'),
  ],
  properties: [
    { id: 'p1', board_id: 'b', name: 'Приоритет', type: 'select', position: 'a', hidden: false, archived_at: null },
    { id: 'p2', board_id: 'b', name: 'Срок', type: 'date', position: 'b', hidden: false, archived_at: null },
  ],
  options: [
    { id: 'o1', property_id: 'p1', label: 'Высокий', color: 'red', position: 'a' },
    { id: 'o2', property_id: 'p1', label: 'Низкий', color: 'gray', position: 'b' },
  ],
  values: [
    { task_id: 't1', property_id: 'p1', value_text: null, value_date: null, option_id: 'o1' },
    { task_id: 't2', property_id: 'p1', value_text: null, value_date: null, option_id: 'o2' },
    { task_id: 't2', property_id: 'p2', value_text: null, value_date: '2026-05-01', option_id: null },
    { task_id: 't3', property_id: 'p1', value_text: null, value_date: null, option_id: 'o1' },
    { task_id: 't4', property_id: 'p1', value_text: null, value_date: null, option_id: 'o1' },
  ],
};
const ids = (list: { id: string }[]) => list.map((t) => t.id);
const manual = { key: 'manual', dir: 'asc' as const };

test('все колонки: порядок колонок слева направо, внутри ручной порядок; архив и корзина не попадают', () => {
  assert.deepEqual(ids(selectTasks(data, { columnId: null, includeArchived: false, view: null })), ['t2', 't1', 't3']);
});

test('архивные включаются по запросу (в том числе из архивной колонки); корзина никогда', () => {
  assert.deepEqual(ids(selectTasks(data, { columnId: null, includeArchived: true, view: null })), ['t2', 't1', 't4', 't3', 't6']);
});

test('одна колонка', () => {
  assert.deepEqual(ids(selectTasks(data, { columnId: 'c2', includeArchived: false, view: null })), ['t3']);
  assert.deepEqual(ids(selectTasks(data, { columnId: 'c3', includeArchived: false, view: null })), []); // архивная колонка без «архива»
  assert.deepEqual(ids(selectTasks(data, { columnId: 'c3', includeArchived: true, view: null })), ['t6']);
});

test('вид: фильтр по списку, поиск и сортировка', () => {
  const filters = { p1: { optionIds: ['o1'] } };
  assert.deepEqual(ids(selectTasks(data, { columnId: null, includeArchived: false, view: { filters, sort: manual, searchIds: null } })), ['t1', 't3']);
  assert.deepEqual(ids(selectTasks(data, { columnId: null, includeArchived: false, view: { filters: {}, sort: manual, searchIds: new Set(['t3', 't2']) } })), ['t2', 't3']);
  // сортировка по сроку по убыванию: пустые в конце колонки
  assert.deepEqual(ids(selectTasks(data, { columnId: 'c1', includeArchived: false, view: { filters: {}, sort: { key: 'p2', dir: 'desc' }, searchIds: null } })), ['t2', 't1']);
});

test('фильтр по архивному свойству не действует (как на доске)', () => {
  const d = { ...data, properties: data.properties.map((p) => (p.id === 'p1' ? { ...p, archived_at: '2026-01-01' } : p)) };
  assert.deepEqual(ids(selectTasks(d, { columnId: null, includeArchived: false, view: { filters: { p1: { optionIds: ['o1'] } }, sort: manual, searchIds: null } })), ['t2', 't1', 't3']);
});
