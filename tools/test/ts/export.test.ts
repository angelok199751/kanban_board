import { buildTable, exportFileName, htmlToText, pickAndOrder, propertyField, SYSTEM_FIELDS } from '../../../src/lib/export';
import { buildCsv, buildXlsx } from '../../../src/lib/xlsx';
import type { Column, ExportTask, Property, PropertyOption, TaskValue } from '../../../src/lib/types';
import { matchesFilters, type ViewContext } from '../../../src/lib/viewConfig';

const eq = (a: unknown, b: unknown, m: string) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`); };

// ---- htmlToText
eq(htmlToText(''), '', 'empty');
eq(htmlToText('<p>Привет <b>мир</b></p><p>Вторая</p>'), 'Привет мир\nВторая', 'paragraphs');
eq(htmlToText('<ul><li>один</li><li>два</li></ul>'), '• один\n• два', 'list');
eq(htmlToText('строка<br>ещё &amp; &lt;b&gt;&nbsp;x'), 'строка\nещё & <b> x', 'entities and br');
eq(htmlToText('<div>a</div><div><br></div><div><br></div><div>b</div>'), 'a\n\n\nb'.replace(/\n{3,}/, '\n\n'), 'blank lines collapse');

// ---- данные
const col = (id: string, name: string, position: string): Column => ({ id, board_id: 'b', name, color: 'gray', position, archived_at: null });
const columns = [col('c2', 'В работе', 'a1'), col('c1', 'Новые', 'a0')];
const prop = (id: string, type: Property['type'], name: string): Property => ({ id, board_id: 'b', name, type, position: 'a0', hidden: false, archived_at: null });
const properties = [prop('who', 'select', 'Исполнитель'), prop('due', 'date', 'Срок'), prop('link', 'url', 'Ссылка'), prop('note', 'text', 'Заметка')];
const options: PropertyOption[] = [{ id: 'anna', property_id: 'who', label: 'Анна', color: 'blue', position: 'a0' }];
const task = (id: string, column_id: string, number: number, title: string, position: string, extra: Partial<ExportTask> = {}): ExportTask =>
  ({ id, column_id, number, title, description_html: '', position, archived_at: null, deleted_at: null, ...extra });
const tasks = [
  task('t1', 'c1', 1, 'Вторая в Новых', 'a1', { description_html: '<p>Текст <b>описания</b></p>' }),
  task('t2', 'c1', 2, 'Первая в Новых', 'a0'),
  task('t3', 'c2', 3, 'В работе', 'a0', { archived_at: '2026-01-01T00:00:00Z' }),
  task('t4', 'c2', 4, 'Удалённая', 'a1', { deleted_at: '2026-01-02T00:00:00Z' }),
];
const values: TaskValue[] = [
  { task_id: 't1', property_id: 'who', option_id: 'anna', value_text: null, value_date: null },
  { task_id: 't1', property_id: 'due', option_id: null, value_text: null, value_date: '2026-03-01' },
  { task_id: 't1', property_id: 'link', option_id: null, value_text: 'https://example.com/x?y=1', value_date: null },
  { task_id: 't2', property_id: 'note', option_id: null, value_text: 'заметка', value_date: null },
];
const propMap = new Map(properties.map((p) => [p.id, p] as const));
const ctx: ViewContext = { properties: propMap, options: new Map(options.map((o) => [o.id, o] as const)),
  valuesOf: (id) => { const l = values.filter((v) => v.task_id === id); return l.length ? new Map(l.map((v) => [v.property_id, v])) : undefined; } };
const manual = { key: 'manual', dir: 'asc' as const };

// ---- выбор и порядок карточек
eq(pickAndOrder(tasks, columns, { columnId: null, keep: null, sort: manual, ctx }).map((t) => t.id), ['t2', 't1', 't3', 't4'], 'columns in board order, cards by position');
eq(pickAndOrder(tasks, columns, { columnId: 'c2', keep: null, sort: manual, ctx }).map((t) => t.id), ['t3', 't4'], 'one column');
eq(pickAndOrder(tasks, columns, { columnId: null, keep: (t) => matchesFilters(t, { who: { optionIds: ['anna'] } }, ctx), sort: manual, ctx }).map((t) => t.id), ['t1'], 'filters apply');
eq(pickAndOrder(tasks, columns, { columnId: 'c1', keep: null, sort: { key: 'number', dir: 'desc' }, ctx }).map((t) => t.id), ['t2', 't1'], 'sort inside column');

// ---- таблица: порядок и набор столбцов задаёт пользователь
const sys = (id: string) => SYSTEM_FIELDS.find((f) => f.id === id)!;
const fields = [propertyField(properties[1]), sys('title'), sys('number'), propertyField(properties[0]), sys('description'), propertyField(properties[2]), sys('state'), sys('column')];
const ordered = pickAndOrder(tasks, columns, { columnId: null, keep: null, sort: manual, ctx });
const table = buildTable(ordered, fields, { columns, options, values });
eq(table.header, ['Срок', 'Название', '№', 'Исполнитель', 'Описание', 'Ссылка', 'Состояние', 'Колонка'], 'header order');
eq(table.rows[1], [{ date: '2026-03-01' }, 'Вторая в Новых', 1, 'Анна', 'Текст описания', 'https://example.com/x?y=1', 'Активна', 'Новые'], 'full row');
eq(table.rows[0], [null, 'Первая в Новых', 2, null, null, null, 'Активна', 'Новые'], 'empty cells are null');
eq(table.rows[2][6], 'В архиве', 'archived state'); eq(table.rows[3][6], 'Удалена', 'deleted state');

// ---- имя файла
eq(exportFileName('Релиз: 143/1', 'Колонка "Новые"', 'xlsx', new Date(2026, 2, 5)), 'Релиз__143_1_Колонка__Новые__2026-03-05.xlsx', 'file name');

eq(buildCsv(table, ';').split('\r\n')[0], 'Срок;Название;№;Исполнитель;Описание;Ссылка;Состояние;Колонка', 'csv header order');
buildXlsx(table, 'Релиз');
console.log('export tests ok');
