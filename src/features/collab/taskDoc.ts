import { Editor } from '@tiptap/core';
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { createBaseExtensions } from '../../lib/editorConfig';
import { prepareHtml } from '../../lib/richHtml';

/**
 * Первый снимок совместного документа из обычного HTML описания или статьи.
 *
 * Нужен, чтобы у всех, кто откроет карточку или статью, была одна и та же
 * история правок. Если каждый начнёт свой Yjs-документ с нуля, при слиянии
 * текст задвоится. Поэтому снимок создаётся один раз и сохраняется в
 * task_docs/article_docs (кто первый — тот и автор), а остальные загружают
 * уже готовое состояние.
 */
export function htmlToYState(html: string): Uint8Array {
  const element = document.createElement('div');
  const editor = new Editor({
    element,
    extensions: createBaseExtensions(),
    content: prepareHtml(html),
  });
  try {
    const doc = prosemirrorJSONToYDoc(editor.schema, editor.getJSON(), 'default');
    const state = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    return state;
  } finally {
    editor.destroy();
  }
}
