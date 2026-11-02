import { buildCsv, buildXlsx, columnLetter, csvSafe, excelSerial, safeSheetName, type Table } from '../../../src/lib/xlsx';

const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`FAIL ${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

eq(columnLetter(0), 'A', 'A'); eq(columnLetter(25), 'Z', 'Z'); eq(columnLetter(26), 'AA', 'AA'); eq(columnLetter(701), 'ZZ', 'ZZ'); eq(columnLetter(702), 'AAA', 'AAA');
eq(excelSerial('1970-01-01'), 25569, 'epoch'); eq(excelSerial('2026-03-01'), 46082, 'date'); eq(excelSerial('2026-02-30'), null, 'invalid day rounds? ');
eq(excelSerial('abc'), null, 'garbage');
eq(csvSafe('=1+1'), "'=1+1", 'formula'); eq(csvSafe('-5'), '-5', 'negative number'); eq(csvSafe('-abc'), "'-abc", 'dash text'); eq(csvSafe('обычный'), 'обычный', 'plain');
eq(safeSheetName('Доска: релиз/1?'), 'Доска релиз 1', 'sheet name'); eq(safeSheetName('   '), 'Лист1', 'empty name');

const table: Table = {
  header: ['№', 'Название', 'Описание', 'Срок', 'Ссылка'],
  rows: [
    [1, 'Первая; "кавычки"', 'строка 1\nстрока 2', { date: '2026-03-01' }, 'https://example.com/a?b=1&c=2'],
    [2, '=ЛОЖЬ()', null, { date: '2026-12-31' }, null],
    [3, 'Эмодзи 😀 и <теги> & амперсанд', 'x', null, 'https://example.com'],
  ],
};
const bytes = buildXlsx(table, 'Доска: релиз');
eq([bytes[0], bytes[1]], [0x50, 0x4b], 'xlsx starts with PK zip signature');
eq(buildCsv(table, ';').split('\r\n').length, 5, 'csv has header + 3 rows + trailing newline');
console.log('xlsx tests ok');
