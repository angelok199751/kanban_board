import { DEFAULT_CONFIG, matchesFilters, normalizeConfig, sameConfig, sortTasks, countActiveFilters, isShownOnCard, type ViewContext } from '../../../src/lib/viewConfig';
import { mergeIntoFull } from '../../../src/lib/order';
import type { Property, PropertyOption, Task, TaskValue } from '../../../src/lib/types';

function eq(a: unknown, b: unknown, m: string) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`);
}
const task = (id: string, number: number, title: string, position: string): Task =>
  ({ id, board_id: 'b', column_id: 'c', number, title, position, version: 1, archived_at: null, deleted_at: null });
const prop = (id: string, type: Property['type'], hidden = false): Property =>
  ({ id, board_id: 'b', name: id, type, position: 'a0', hidden, archived_at: null });
const opt = (id: string, property_id: string, position: string): PropertyOption =>
  ({ id, property_id, label: id, color: 'gray', position });

const properties = new Map([['who', prop('who', 'select')], ['note', prop('note', 'text')], ['due', prop('due', 'date')]]);
const options = new Map([['anna', opt('anna', 'who', 'a0')], ['boris', opt('boris', 'who', 'a1')]]);
const vals: Record<string, TaskValue[]> = {
  t1: [{ task_id: 't1', property_id: 'who', option_id: 'anna', value_text: null, value_date: null },
       { task_id: 't1', property_id: 'due', option_id: null, value_text: null, value_date: '2026-03-10' },
       { task_id: 't1', property_id: 'note', option_id: null, value_text: 'Срочно: Релиз', value_date: null }],
  t2: [{ task_id: 't2', property_id: 'who', option_id: 'boris', value_text: null, value_date: null },
       { task_id: 't2', property_id: 'due', option_id: null, value_text: null, value_date: '2026-03-01' }],
  t3: [],
};
const ctx: ViewContext = {
  properties, options,
  valuesOf: (id) => { const l = vals[id]; return l ? new Map(l.map((v) => [v.property_id, v])) : undefined; },
};
const tasks = [task('t1', 1, 'Бета', 'a2'), task('t2', 2, 'альфа', 'a1'), task('t3', 3, 'Гамма 10', 'a0')];

// normalize
eq(normalizeConfig(null), DEFAULT_CONFIG, 'null -> default');
eq(normalizeConfig({ filters: { x: { optionIds: [] }, y: { contains: '  ' } } }).filters, {}, 'inactive filters dropped');
eq(normalizeConfig({ filters: { who: { optionIds: ['b', 'a'] } } }).filters, { who: { optionIds: ['a', 'b'] } }, 'ids sorted');
eq(normalizeConfig({ sort: { key: 'title', dir: 'desc' }, compact: true, cardProps: ['who', 5] }), { filters: {}, sort: { key: 'title', dir: 'desc' }, compact: true, cardProps: ['who'] }, 'sort/compact/cardProps');
eq(sameConfig(DEFAULT_CONFIG, normalizeConfig({ filters: {} })), true, 'same');

// filters
const f = (filters: object) => tasks.filter((t) => matchesFilters(t, normalizeConfig({ filters }).filters, ctx)).map((t) => t.id);
eq(f({ who: { optionIds: ['anna'] } }), ['t1'], 'select anna');
eq(f({ who: { optionIds: ['anna'], empty: true } }), ['t1', 't3'], 'anna or empty');
eq(f({ who: { empty: true } }), ['t3'], 'empty only');
eq(f({ note: { contains: 'релиз' } }), ['t1'], 'contains case-insensitive');
eq(f({ due: { from: '2026-03-05' } }), ['t1'], 'date from');
eq(f({ due: { to: '2026-03-05' } }), ['t2'], 'date to');
eq(f({ due: { from: '2026-03-01', to: '2026-03-10' } }), ['t1', 't2'], 'date range inclusive');
eq(f({ ghost: { contains: 'x' } }), ['t1', 't2', 't3'], 'unknown property ignored');
eq(f({ who: { optionIds: ['anna'] }, note: { contains: 'нет' } }), [], 'AND');
eq(countActiveFilters(normalizeConfig({ filters: { who: { empty: true }, ghost: { empty: true } } }), properties), 1, 'count ignores missing property');

// sort
const s = (key: string, dir: 'asc' | 'desc') => sortTasks(tasks, { key, dir }, ctx).map((t) => t.id);
eq(s('manual', 'asc'), ['t3', 't2', 't1'], 'manual by position');
eq(s('number', 'desc'), ['t3', 't2', 't1'], 'number desc');
eq(s('title', 'asc'), ['t2', 't1', 't3'], 'title asc (case-insensitive, ru)');
eq(s('who', 'asc'), ['t1', 't2', 't3'], 'select by option order, empty last');
eq(s('who', 'desc'), ['t2', 't1', 't3'], 'select desc, empty still last');
eq(s('due', 'asc'), ['t2', 't1', 't3'], 'date asc, empty last');
eq(s('ghost', 'asc'), ['t3', 't2', 't1'], 'missing property falls back to manual');

// card visibility
eq(isShownOnCard(prop('p', 'text', true), DEFAULT_CONFIG), false, 'hidden by default');
eq(isShownOnCard(prop('p', 'text', true), { ...DEFAULT_CONFIG, cardProps: ['p'] }), true, 'view overrides');
eq(isShownOnCard(prop('p', 'text', false), { ...DEFAULT_CONFIG, cardProps: [] }), false, 'view hides');

// merge
eq(mergeIntoFull(['a', 'h1', 'b', 'h2', 'c'], ['a', 'x', 'b', 'c'], 'x'), ['a', 'x', 'h1', 'b', 'h2', 'c'], 'after visible predecessor');
eq(mergeIntoFull(['h0', 'a', 'b'], ['x', 'a', 'b'], 'x'), ['h0', 'x', 'a', 'b'], 'before visible successor');
eq(mergeIntoFull([], ['x'], 'x'), ['x'], 'empty column');
eq(mergeIntoFull(['a', 'x', 'b'], ['b', 'x', 'a'], 'x'), ['a', 'b', 'x'], 'moved within column');
console.log('view tests ok');
