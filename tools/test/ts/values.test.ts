import { copyValueInputs, selectedOptionIds } from '../../../src/lib/values';

const eq = (a: unknown, b: unknown, m: string) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`);
};

eq(selectedOptionIds(undefined), [], 'нет значения');
eq(selectedOptionIds({ option_id: null, option_ids: [] }), [], 'пустой список');
eq(selectedOptionIds({ option_id: 'a', option_ids: [] }), ['a'], 'старый одиночный вид');
eq(selectedOptionIds({ option_id: null, option_ids: ['a', 'b'] }), ['a', 'b'], 'множественный вид');
eq(selectedOptionIds({ option_id: 'a', option_ids: ['b'] }), ['b'], 'массив важнее одиночного поля');

// копия карточки: заполненные значения переносятся, пустые пропускаются, новый task_id
eq(
  copyValueInputs('new-task', [
    { task_id: 'old-task', property_id: 'who', option_id: 'a', option_ids: [], value_text: null, value_date: null, updated_at: 'x' },
    { task_id: 'old-task', property_id: 'tags', option_id: null, option_ids: ['a', 'b'], value_text: null, value_date: null, updated_at: 'x' },
    { task_id: 'old-task', property_id: 'note', option_id: null, option_ids: [], value_text: 'текст', value_date: null, updated_at: 'x' },
    { task_id: 'old-task', property_id: 'empty', option_id: null, option_ids: [], value_text: null, value_date: null, updated_at: 'x' },
  ]),
  [
    { task_id: 'new-task', property_id: 'who', value_text: null, value_date: null, option_id: 'a', option_ids: [] },
    { task_id: 'new-task', property_id: 'tags', value_text: null, value_date: null, option_id: null, option_ids: ['a', 'b'] },
    { task_id: 'new-task', property_id: 'note', value_text: 'текст', value_date: null, option_id: null, option_ids: [] },
  ],
  'копия значений',
);

console.log('values tests ok');
