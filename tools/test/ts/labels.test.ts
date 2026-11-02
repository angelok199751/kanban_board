import { labelsToText, parseLabels, sameLabels } from '../../../src/lib/labels';

const eq = (a: unknown, b: unknown, m: string) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`); };

eq(parseLabels('релиз, Чек-лист ,релиз'), ['релиз', 'Чек-лист'], 'trim and dedupe');
eq(parseLabels('Релиз, релиз, РЕЛИЗ'), ['Релиз'], 'case-insensitive dedupe keeps first');
eq(parseLabels(' , ,'), [], 'only empty parts');
eq(parseLabels(''), [], 'empty');
eq(parseLabels('a'.repeat(60))[0].length, 40, 'label length limit');
eq(parseLabels(Array.from({ length: 30 }, (_, i) => `м${i}`).join(',')).length, 20, 'max 20 labels');
eq(labelsToText(['a', 'b']), 'a, b', 'to text');
eq(sameLabels(['a', 'b'], ['a', 'b']), true, 'same');
eq(sameLabels(['a', 'b'], ['b', 'a']), false, 'order matters');
console.log('labels tests ok');
