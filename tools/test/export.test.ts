// Тесты экспорта (src/lib/export.ts). Запуск: npx tsx --test tools/test/export.test.ts
// Файл XLSX дополнительно проверяется внешним читателем: см. tools/test/README.md.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildTable, columnLetter, crc32, excelSerial, exportFileName, sheetName, toCsv, toXlsx,
  type ExportField, type ExportSource,
} from '../../src/lib/export.ts';

const task = (id: string, number: number, title: string, column_id = 'c1') => ({
  id, board_id: 'b', column_id, number, title, position: 'a', version: 1, archived_at: null, deleted_at: null,
});
const prop = (id: string, name: string, type: 'select' | 'text' | 'url' | 'date') => ({
  id, board_id: 'b', name, type, position: 'a', hidden: false, archived_at: null,
});
const value = (task_id: string, property_id: string, p: Partial<{ value_text: string; value_date: string; option_id: string }>) => ({
  task_id, property_id, value_text: null, value_date: null, option_id: null, ...p,
});

const source: ExportSource = {
  tasks: [task('t1', 1, 'Падает "вход"; точка с запятой'), task('t2', 2, '=SUM(A1)', 'c2'), task('t3', 3, 'Пустая')],
  columns: [
    { id: 'c1', board_id: 'b', name: 'К работе', color: 'gray', position: 'a', archived_at: null },
    { id: 'c2', board_id: 'b', name: 'Готово', color: 'green', position: 'b', archived_at: null },
  ],
  properties: [
    prop('p1', 'Приоритет', 'select'), prop('p2', 'Ссылка', 'url'), prop('p3', 'Срок', 'date'), prop('p4', 'Название', 'text'),
  ],
  options: [{ id: 'o1', property_id: 'p1', label: 'Высокий', color: 'red', position: 'a' }],
  values: [
    value('t1', 'p1', { option_id: 'o1' }),
    value('t1', 'p2', { value_text: 'https://example.com/a?b=1&c=2' }),
    value('t1', 'p3', { value_date: '2026-03-01' }),
    value('t2', 'p3', { value_date: '2026-12-31' }),
    value('t2', 'p4', { value_text: '@cmd' }),
  ],
  descriptions: new Map([['t1', 'Строка 1\nСтрока 2 <b>&</b>']]),
};
const fields: ExportField[] = [
  { kind: 'system', key: 'number' }, { kind: 'system', key: 'title' }, { kind: 'system', key: 'column' },
  { kind: 'property', propertyId: 'p3' }, { kind: 'property', propertyId: 'p1' }, { kind: 'property', propertyId: 'p2' },
  { kind: 'property', propertyId: 'p4' }, { kind: 'system', key: 'description' }, { kind: 'property', propertyId: 'gone' },
];

test('таблица: порядок, читаемые значения, уникальные заголовки, неизвестное свойство пропущено', () => {
  const t = buildTable(source, fields);
  assert.deepEqual(t.headers, ['Номер', 'Название', 'Колонка', 'Срок', 'Приоритет', 'Ссылка', 'Название (2)', 'Описание']);
  assert.equal(t.rows.length, 3);
  assert.deepEqual(t.rows[0][2], { t: 'text', v: 'К работе' });
  assert.deepEqual(t.rows[0][3], { t: 'date', v: '2026-03-01' });
  assert.deepEqual(t.rows[0][4], { t: 'text', v: 'Высокий' });
  assert.deepEqual(t.rows[0][5], { t: 'text', v: 'https://example.com/a?b=1&c=2' });
  assert.equal(t.rows[2][3], null);
  assert.equal(t.rows[1][2] && (t.rows[1][2] as { v: string }).v, 'Готово');
});

test('CSV: BOM, кавычки, разделитель, защита от формул, даты без сдвига', () => {
  const csv = toCsv(buildTable(source, fields));
  assert.ok(csv.startsWith('﻿Номер;Название;'));
  const lines = csv.split('\r\n');
  assert.equal(lines[1], '1;"Падает ""вход""; точка с запятой";К работе;01.03.2026;Высокий;https://example.com/a?b=1&c=2;;"Строка 1\nСтрока 2 <b>&</b>"');
  assert.ok(lines[2].startsWith("2;'=SUM(A1);Готово;31.12.2026;;;'@cmd;"));
  assert.equal(lines[4], '');
  assert.ok(toCsv(buildTable(source, fields), { delimiter: ',' }).includes('1,"Падает ""вход""; точка с запятой",К работе,'));
});

test('даты: серийные номера Excel совпадают с эталоном', () => {
  assert.equal(excelSerial('1970-01-01'), 25569);
  assert.equal(excelSerial('2000-01-01'), 36526);
  assert.equal(excelSerial('2026-03-01'), 46082);
  assert.equal(excelSerial('2024-02-29') as number - (excelSerial('2024-02-28') as number), 1);
  assert.equal(excelSerial('не дата'), null);
});

test('мелочи: буквы столбцов, имя листа и файла, crc32', () => {
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(columnLetter), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  assert.equal(sheetName('Доска: [тест]/1?'), 'Доска тест 1');
  assert.equal(sheetName('***'), 'Задачи');
  assert.equal(sheetName('x'.repeat(50)).length, 31);
  assert.equal(exportFileName('Релиз: 1/2?', 'csv', '2026-10-22'), 'Релиз 1 2 2026-10-22.csv');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('поле «В архиве»: «Да» только у архивных задач', () => {
  const src = { ...source, tasks: [task('t1', 1, 'Обычная'), { ...task('t2', 2, 'Старая'), archived_at: '2026-01-01' }] };
  const t = buildTable(src, [{ kind: 'system', key: 'archived' }]);
  assert.deepEqual(t.headers, ['В архиве']);
  assert.deepEqual(t.rows, [[null], [{ t: 'text', v: 'Да' }]]);
});

test('XLSX: файл собирается и записывается для внешней проверки', () => {
  const bytes = toXlsx(buildTable(source, fields), 'Доска: релиз');
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const out = process.env.XLSX_OUT;
  if (out) writeFileSync(out, bytes);
});
