import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';

export const DESCRIPTION_PLACEHOLDER = 'Добавь описание: подробности, шаги воспроизведения, ссылки…';

/**
 * Одна и та же разметка для редактора и для первого снимка совместного документа:
 * только то, что разрешает sanitizeHtml. Заголовки, цитаты и код не нужны.
 * undoRedo отключается в совместном режиме: там историей правок управляет Yjs,
 * иначе Ctrl+Z отменял бы только свои шаги в обход общей истории.
 */
export function createBaseExtensions({ collaborative = false }: { collaborative?: boolean } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      trailingNode: false,
      undoRedo: collaborative ? false : undefined,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: false,
        defaultProtocol: 'https',
        shouldAutoLink: (url) => /^https?:\/\//i.test(url),
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      },
    }),
    Placeholder.configure({ placeholder: DESCRIPTION_PLACEHOLDER }),
  ];
}
