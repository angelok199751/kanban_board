const BLOCK = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE']);

/**
 * Описание карточки (HTML) -> обычный текст для файла: абзацы и пункты списков на отдельных строках,
 * ссылка без видимого адреса выводится как «текст (адрес)». Разметка и скрипты в текст не попадают.
 */
export function htmlToText(html: string): string {
  if (html.trim() === '') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let out = '';
  const newline = () => {
    if (out !== '' && !out.endsWith('\n')) out += '\n';
  };

  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.nodeValue ?? '').replace(/\s+/g, ' ');
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      if (tag === 'BR') {
        out += '\n';
        continue;
      }
      const block = BLOCK.has(tag);
      if (block) newline();
      if (tag === 'LI') out += '• ';
      if (tag === 'A') {
        const href = el.getAttribute('href') ?? '';
        const before = out.length;
        walk(el);
        const text = out.slice(before).trim();
        if (href !== '' && text !== href) out += ` (${href})`;
        continue;
      }
      walk(el);
      if (block) newline();
    }
  };
  walk(doc.body);
  return out
    .split('\n')
    .map((l) => l.replace(/[  ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
