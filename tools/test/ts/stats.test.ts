import { computeStats, percentOf } from '../../../src/lib/stats';

const eq = (a: unknown, b: unknown, m: string) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`); };

const col = (id: string, name: string, position: string) => ({ id, board_id: 'b', name, color: 'blue' as const, position, archived_at: null });
const columns = [col('c2', 'Готово', 'a1'), col('c1', 'Новые', 'a0'), col('c3', 'Пусто', 'a2')];
const prop = (id: string, type: 'select' | 'text', position: string, archived_at: string | null = null) => ({ id, board_id: 'b', name: id, type, position, hidden: false, archived_at });
const properties = [prop('who', 'select', 'a0'), prop('note', 'text', 'a1'), prop('old', 'select', 'a2', '2026-01-01T00:00:00Z')];
const opt = (id: string, property_id: string, position: string) => ({ id, property_id, label: id, color: 'gray' as const, position });
const options = [opt('boris', 'who', 'a1'), opt('anna', 'who', 'a0')];
const tasks = [
  { id: 't1', column_id: 'c1' }, { id: 't2', column_id: 'c1' }, { id: 't3', column_id: 'c2' }, { id: 't4', column_id: 'ghost' },
];
const v = (task_id: string, property_id: string, option_id: string | null) => ({ task_id, property_id, option_id, value_text: null, value_date: null, updated_at: 'x' });
const values = [v('t1', 'who', 'anna'), v('t2', 'who', 'anna'), v('t3', 'who', 'boris'), v('t9', 'who', 'anna')];

const s = computeStats({ columns, tasks, properties, options, values });
eq(s.total, 4, 'total counts all given tasks');
eq(s.byColumn.map((b) => [b.label, b.count]), [['Новые', 2], ['Готово', 1], ['Пусто', 0]], 'columns in board order, zero kept, unknown column ignored');
eq(s.byProperty.length, 1, 'only active select properties');
eq(s.byProperty[0].buckets.map((b) => [b.label, b.count]), [['anna', 2], ['boris', 1], ['Не задано', 1]], 'options by position and empty bucket');
eq(s.byProperty[0].buckets.reduce((n, b) => n + b.count, 0), 4, 'buckets add up to total');
eq(percentOf(1, 4), 25, 'percent'); eq(percentOf(1, 3), 33, 'percent rounds'); eq(percentOf(0, 0), 0, 'percent of nothing');

const filtered = computeStats({ columns, tasks: [tasks[0]], properties, options, values });
eq(filtered.total, 1, 'filtered total'); eq(filtered.byColumn[0].count, 1, 'filtered column'); eq(filtered.byProperty[0].buckets[0].count, 1, 'filtered option');
console.log('stats tests ok');
