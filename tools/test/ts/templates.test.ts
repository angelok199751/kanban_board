import {
  cleanTemplateName,
  normalizeStructure,
  structureFromBoard,
  uniqueName,
  type BoardTemplateStructure,
} from '../../../src/lib/templates';
import type { BoardData } from '../../../src/lib/types';

const eq = (a: unknown, b: unknown, m: string) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`);
};

// ---------------------------------------------------------------- нормализация
eq(normalizeStructure(null), { columns: [], properties: [] }, 'не объект');
eq(normalizeStructure({ columns: 'нет', properties: {} }), { columns: [], properties: [] }, 'поля не массивы');

const normalized = normalizeStructure({
  columns: [
    { name: '  Новые  ', color: 'green' },
    { name: 'новые', color: 'red' }, // дубль без учёта регистра
    { name: '', color: 'blue' }, // пустое имя
    { name: 'Готово', color: 'неизвестный' },
  ],
  properties: [
    {
      name: 'Исполнитель',
      type: 'select',
      multiple: true,
      hidden: true,
      options: [
        { label: 'Анна', color: 'pink' },
        { label: 'анна', color: 'blue' }, // дубль варианта
        { label: '', color: 'blue' }, // пустой вариант
      ],
    },
    { name: 'исполнитель', type: 'text' }, // дубль свойства
    { name: 'Срок', type: 'date', multiple: true, options: [{ label: 'лишнее', color: 'red' }] },
    { name: 'Неизвестное', type: 'number', hidden: false },
  ],
});

eq(normalized.columns, [{ name: 'Новые', color: 'green' }, { name: 'Готово', color: 'gray' }], 'колонки');
eq(normalized.properties.length, 3, 'свойства: дубли убраны');
eq(normalized.properties[0], {
  name: 'Исполнитель',
  type: 'select',
  multiple: true,
  hidden: true,
  options: [{ label: 'Анна', color: 'pink' }],
}, 'список: режим, видимость и варианты');
eq(normalized.properties[1], {
  name: 'Срок',
  type: 'date',
  multiple: false,
  hidden: false,
  options: [],
}, 'дата: несколько значений и варианты запрещены');
eq(normalized.properties[2], {
  name: 'Неизвестное',
  type: 'text',
  multiple: false,
  hidden: false,
  options: [],
}, 'неизвестный тип становится текстом');

const longName = 'я'.repeat(100);
const clamped = normalizeStructure({ columns: [{ name: longName, color: 'gray' }] });
eq(clamped.columns[0].name.length, 60, 'имя колонки обрезано до 60');

// ---------------------------------------------------------------- снимок доски
const data: BoardData = {
  columns: [
    { id: 'c2', board_id: 'b', name: 'В работе', color: 'blue', position: 'a1', archived_at: null },
    { id: 'c1', board_id: 'b', name: 'Новые', color: 'green', position: 'a0', archived_at: null },
    { id: 'c3', board_id: 'b', name: 'Архивная', color: 'gray', position: 'a2', archived_at: '2026-01-01T00:00:00Z' },
  ],
  properties: [
    { id: 'p2', board_id: 'b', name: 'Исполнитель', type: 'select', multiple: true, position: 'a1', hidden: false, archived_at: null },
    { id: 'p1', board_id: 'b', name: 'Заметка', type: 'text', multiple: false, position: 'a0', hidden: true, archived_at: null },
    { id: 'p3', board_id: 'b', name: 'Старое', type: 'date', multiple: false, position: 'a2', hidden: false, archived_at: '2026-01-01T00:00:00Z' },
  ],
  options: [
    { id: 'o2', property_id: 'p2', label: 'Борис', color: 'blue', position: 'a1' },
    { id: 'o1', property_id: 'p2', label: 'Анна', color: 'pink', position: 'a0' },
    { id: 'o3', property_id: 'p1', label: 'Лишний', color: 'red', position: 'a0' },
  ],
  tasks: [],
  values: [],
};

const snapshot: BoardTemplateStructure = structureFromBoard(data);
eq(snapshot.columns, [
  { name: 'Новые', color: 'green' },
  { name: 'В работе', color: 'blue' },
], 'снимок: архивные колонки убраны, порядок по position');
eq(snapshot.properties, [
  { name: 'Заметка', type: 'text', multiple: false, hidden: true, options: [] },
  {
    name: 'Исполнитель',
    type: 'select',
    multiple: true,
    hidden: false,
    options: [{ label: 'Анна', color: 'pink' }, { label: 'Борис', color: 'blue' }],
  },
], 'снимок: свойства и варианты без архивных и лишних');

// ---------------------------------------------------------------- имена без конфликтов
eq(uniqueName('Колонка', ['Колонка']), 'Колонка (2)', 'первый конфликт');
eq(uniqueName('колонка', ['  Колонка  ']), 'колонка (2)', 'конфликт без учёта регистра и пробелов');
eq(uniqueName('Колонка', ['Колонка', 'Колонка (2)']), 'Колонка (3)', 'следующий свободный номер');
eq(uniqueName('Новая', ['Другая']), 'Новая', 'свободное имя не меняется');
const longBase = 'ж'.repeat(60);
const longUnique = uniqueName(longBase, [longBase]);
eq(longUnique.length, 60, 'имя с суффиксом укладывается в 60 символов');
eq(longUnique.endsWith(' (2)'), true, 'суффикс сохраняется при обрезке');

eq(cleanTemplateName('  Релиз  '), 'Релиз', 'название шаблона без пробелов');
eq(cleanTemplateName('т'.repeat(120)).length, 100, 'название шаблона обрезано до 100');

console.log('templates tests ok');
