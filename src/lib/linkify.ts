import { isValidUrl } from './format';

export interface UrlMatch {
  start: number;
  end: number;
  url: string;
}

// Ссылка в тексте: только http/https, как и в свойстве-ссылке.
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
// Знаки, которые обычно стоят после ссылки, а не входят в неё.
const TRAILING_RE = /[.,;:!?…"'»”’)\]}]+$/;

/** Находит ссылки в обычном тексте и отбрасывает завершающую пунктуацию. */
export function findUrls(text: string): UrlMatch[] {
  const out: UrlMatch[] = [];
  for (const match of text.matchAll(URL_RE)) {
    const raw = match[0];
    const url = raw.replace(TRAILING_RE, '');
    if (!isValidUrl(url)) continue;
    const start = match.index ?? 0;
    out.push({ start, end: start + url.length, url });
  }
  return out;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Простой текст -> HTML, где найденные ссылки уже являются ссылками. */
export function linkifyText(text: string): string {
  let out = '';
  let last = 0;
  for (const match of findUrls(text)) {
    out += escapeHtml(text.slice(last, match.start));
    const url = escapeHtml(match.url);
    out += `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    last = match.end;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

/**
 * Заменяет ссылки в текстовых узлах DOM на <a>, не трогая уже готовые ссылки.
 * Нужен и для вставки, и для уже сохранённого описания: ссылки становятся кликабельными сразу.
 */
export function linkifyDom(root: HTMLElement): boolean {
  if (typeof document === 'undefined') return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || findUrls(node.nodeValue).length === 0) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest('a')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  let changed = false;
  for (const node of nodes) {
    const value = node.nodeValue ?? '';
    const matches = findUrls(value);
    if (matches.length === 0) continue;

    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of matches) {
      if (match.start > last) fragment.append(document.createTextNode(value.slice(last, match.start)));
      const link = document.createElement('a');
      link.href = match.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = match.url;
      fragment.append(link);
      last = match.end;
    }
    if (last < value.length) fragment.append(document.createTextNode(value.slice(last)));
    node.replaceWith(fragment);
    changed = true;
  }
  return changed;
}
