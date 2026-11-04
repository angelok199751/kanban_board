import { linkifyDom } from './linkify';
import { sanitizeHtml } from './sanitize';

/**
 * Готовит сохранённый HTML к показу: убирает лишние теги и делает ссылки кликабельными.
 * Так же готовится исходное содержимое при первом создании CRDT-документа,
 * чтобы у всех участников была одинаковая отправная точка.
 */
export function prepareHtml(html: string): string {
  const clean = sanitizeHtml(html);
  if (typeof document === 'undefined') return clean;
  const root = document.createElement('div');
  root.innerHTML = clean;
  // уже сохранённые описания тоже показываем со ссылками; сохранятся они при следующей правке
  linkifyDom(root);
  return root.innerHTML;
}
