import { buildCardFields } from '../../../src/lib/cardFields';

const eq = (a: unknown, b: unknown, m: string) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`); };

const prop = (id: string, type: 'select' | 'text' | 'url' | 'date', name = id) => ({ id, board_id: 'b', name, type, position: 'a0', hidden: false, archived_at: null });
const props = [prop('who', 'select', 'Исполнитель'), prop('due', 'date', 'Срок'), prop('link', 'url', 'Ссылка'), prop('note', 'text', 'Заметка')];
const options = new Map([
  ['anna', { id: 'anna', property_id: 'who', label: 'Анна', color: 'blue' as const, position: 'a0' }],
  ['boris', { id: 'boris', property_id: 'who', label: 'Борис', color: 'green' as const, position: 'a1' }],
]);
const v = (property_id: string, patch: object) => [property_id, { task_id: 't', property_id, value_text: null, value_date: null, option_id: null, updated_at: 'x', ...patch }] as const;

const values = new Map([
  v('who', { option_id: 'anna' }), v('due', { value_date: '2026-03-01' }),
  v('link', { value_text: 'https://www.example.com/a?b=1' }), v('note', { value_text: 'Проверить' }),
]);
const f = buildCardFields(props, values, options);
eq(f.map((x) => x.text), ['Анна', '01.03.2026', 'example.com', 'Заметка: Проверить'], 'тексты пилюль в порядке свойств');
eq(f.map((x) => x.tone), ['blue', 'orange', undefined, 'gray'], 'цвета: вариант, дата оранжевая, ссылка без цвета, текст серый');
eq(f[2].url, 'https://www.example.com/a?b=1', 'ссылка кликабельна');

eq(buildCardFields(props, undefined, options), [], 'нет значений');
eq(buildCardFields(props, new Map([v('link', { value_text: 'просто текст' })]), options)[0], { id: 'link', name: 'Ссылка', type: 'url', text: 'Ссылка: просто текст', tone: 'gray' }, 'некорректная ссылка показывается текстом, не ссылкой');
eq(buildCardFields(props, new Map([v('who', { option_id: 'удалён' })]), options), [], 'удалённый вариант пропускается');
eq(buildCardFields([props[1]], values, options).length, 1, 'берутся только переданные свойства');
eq(
  buildCardFields(
    [{ ...props[0], multiple: true }],
    new Map([v('who', { option_ids: ['anna', 'boris'] })]),
    options,
  ).map((x) => [x.id, x.text, x.tone]),
  [['who:anna', 'Анна', 'blue'], ['who:boris', 'Борис', 'green']],
  'несколько выбранных вариантов показываются отдельными пилюлями',
);
console.log('cardFields tests ok');
