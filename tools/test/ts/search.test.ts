import { likePattern } from '../../../src/lib/search';
const eq = (a: string, b: string, m: string) => { if (a !== b) throw new Error(`FAIL ${m}: ${a} != ${b}`); };
eq(likePattern('abc'), '"%abc%"', 'plain');
eq(likePattern('50%'), '"%50\\\\%%"', 'percent');          // LIKE: \%, в кавычках: \\%
eq(likePattern('a_b'), '"%a\\\\_b%"', 'underscore');
eq(likePattern('a,b)'), '"%a,b)%"', 'comma and paren stay inside quotes');
eq(likePattern('say "hi"'), '"%say \\"hi\\"%"', 'quotes');
eq(likePattern('c:\\dir'), '"%c:\\\\\\\\dir%"', 'backslash');
console.log('search tests ok');
