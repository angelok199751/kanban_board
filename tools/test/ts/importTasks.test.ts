import { importSummary, parseImportTable } from '../../../src/lib/importTasks';

const eq = (a: unknown, b: unknown, m: string) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`);
};

// ---------------------------------------------------------------- заголовок и CRLF
const withHeader = parseImportTable(
  'Название\tСсылка на задачу\r\nПервый\t https://example.test/1 \r\n\r\nВторой\r\n\t https://example.test/2 \r\n',
);
eq(withHeader.headerSkipped, true, 'заголовок распознан');
eq(withHeader.rows, [
  { line: 2, title: 'Первый', link: 'https://example.test/1', invalidLink: false },
  { line: 4, title: 'Второй', link: '', invalidLink: false },
], 'строки после заголовка, пробелы обрезаны');
eq(withHeader.skipped, 1, 'строка без названия пропущена');
eq(importSummary(withHeader), { total: 2, withLink: 1, invalidLinks: 0 }, 'сводка с заголовком');

// ---------------------------------------------------------------- заголовок без второй колонки
const titleHeader = parseImportTable('Заголовок\nКарточка\t https://example.test/x');
eq(titleHeader.headerSkipped, true, 'одноколоночный заголовок');
eq(titleHeader.rows.length, 1, 'после заголовка одна карточка');
eq(titleHeader.rows[0].invalidLink, false, 'ссылка верная');

// ---------------------------------------------------------------- без заголовка, только названия
const titleOnly = parseImportTable('Задача А\nЗадача Б\n\nЗадача В\t');
eq(titleOnly.headerSkipped, false, 'обычная первая строка не считается заголовком');
eq(titleOnly.rows.map((r) => r.title), ['Задача А', 'Задача Б', 'Задача В'], 'только названия');
eq(titleOnly.rows.map((r) => r.line), [1, 2, 4], 'номера строк исходного текста');
eq(titleOnly.rows.every((r) => r.link === '' && !r.invalidLink), true, 'ссылок нет');

// ---------------------------------------------------------------- неверные ссылки
const invalid = parseImportTable('Карточка\tnot-a-url\nЕщё\tftp://example.test/file\nВерная\thttps://example.test/ok');
eq(invalid.rows.map((r) => r.invalidLink), [true, true, false], 'не http(s) помечены');
eq(importSummary(invalid), { total: 3, withLink: 3, invalidLinks: 2 }, 'сводка с ошибками');

// ---------------------------------------------------------------- лишние колонки
const extra = parseImportTable('Карточка\thttps://example.test/x\tлишнее\tещё\tодно');
eq(extra.rows.length, 1, 'строка одна');
eq(extra.rows[0].title, 'Карточка', 'название из первой колонки');
eq(extra.rows[0].link, 'https://example.test/x', 'ссылка из второй колонки');
eq(extra.rows[0].invalidLink, false, 'лишние колонки не мешают');

// ---------------------------------------------------------------- заголовок на английском
const english = parseImportTable('Title\tURL\nTask\t https://example.test/y ');
eq(english.headerSkipped, true, 'английский заголовок');
eq(english.rows, [{ line: 2, title: 'Task', link: 'https://example.test/y', invalidLink: false }], 'карточка после заголовка');

// ---------------------------------------------------------------- пустой ввод
eq(parseImportTable(''), { rows: [], skipped: 0, headerSkipped: false }, 'пустой текст');
eq(parseImportTable('   \n\n\t\n'), { rows: [], skipped: 0, headerSkipped: false }, 'только пробельные строки');

console.log('importTasks tests ok');
