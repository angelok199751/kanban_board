import { selectedOptionIds } from '../../../src/lib/values';

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

console.log('values tests ok');
