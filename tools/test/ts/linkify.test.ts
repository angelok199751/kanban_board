import { findUrls, linkifyDom, linkifyText } from '../../../src/lib/linkify';

const eq = (a: unknown, b: unknown, m: string) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`);
};

eq(findUrls('просто текст'), [], 'no urls');
eq(findUrls('https://example.com/a?b=1'), [{ start: 0, end: 25, url: 'https://example.com/a?b=1' }], 'simple url');
eq(
  findUrls('Смотри https://example.com/a, потом http://x.io.'),
  [
    { start: 7, end: 28, url: 'https://example.com/a' },
    { start: 36, end: 47, url: 'http://x.io' },
  ],
  'punctuation and two urls',
);
eq(findUrls('javascript:alert(1) ftp://x.io www.example.com'), [], 'only http/https');
eq(findUrls('(https://example.com/a)'), [{ start: 1, end: 22, url: 'https://example.com/a' }], 'closing bracket');

eq(
  linkifyText('Ссылка: https://x.io/a?b=1&c=2.'),
  'Ссылка: <a href="https://x.io/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">https://x.io/a?b=1&amp;c=2</a>.',
  'linkify and escape',
);
eq(linkifyText('без ссылок <b>'), 'без ссылок &lt;b&gt;', 'escape plain text');
eq(linkifyDom({} as HTMLElement), false, 'no DOM in Node');

console.log('linkify tests ok');
