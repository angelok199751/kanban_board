import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { isValidUrl } from '../lib/format';
import { findUrls, linkifyDom } from '../lib/linkify';
import { sanitizeHtml } from '../lib/sanitize';

const PLACEHOLDER = 'Добавь описание: подробности, шаги воспроизведения, ссылки…';

type LinkMark = { type: 'link'; attrs: { href: string; target: string; rel: string } };
type InlineNode = { type: 'text'; text: string; marks?: LinkMark[] };

/** Готовит сохранённый HTML к показу: убирает лишние теги и делает ссылки кликабельными. */
function prepareHtml(html: string): string {
  const clean = sanitizeHtml(html);
  if (typeof document === 'undefined') return clean;
  const root = document.createElement('div');
  root.innerHTML = clean;
  // уже сохранённые описания тоже показываем со ссылками; сохранятся они при следующей правке
  linkifyDom(root);
  return root.innerHTML;
}

/** Строка текста -> узлы документа, где найденные ссылки уже являются ссылками. */
function inlineNodes(line: string): InlineNode[] {
  const matches = findUrls(line);
  if (matches.length === 0) return line === '' ? [] : [{ type: 'text', text: line }];

  const nodes: InlineNode[] = [];
  let last = 0;
  for (const match of matches) {
    if (match.start > last) nodes.push({ type: 'text', text: line.slice(last, match.start) });
    nodes.push({
      type: 'text',
      text: match.url,
      marks: [{ type: 'link', attrs: { href: match.url, target: '_blank', rel: 'noopener noreferrer' } }],
    });
    last = match.end;
  }
  if (last < line.length) nodes.push({ type: 'text', text: line.slice(last) });
  return nodes;
}

/** Вставляет текст как простой: чужая разметка в описание не попадает, ссылки становятся ссылками. */
function insertPlainText(editor: Editor, text: string) {
  if (!/[\r\n]/.test(text)) {
    if (findUrls(text).length > 0) {
      editor.chain().focus().insertContent(inlineNodes(text)).run();
    } else {
      editor.chain().focus().insertContent([{ type: 'text', text }]).run();
    }
    return;
  }

  const blocks = text.split(/\r\n|\r|\n/).map((line) => {
    const content = inlineNodes(line);
    return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
  });
  editor.chain().focus().insertContent(blocks).run();
}

const COMMANDS: { key: string; label: ReactNode; title: string; run: (editor: Editor) => void }[] = [
  { key: 'bold', label: <b>B</b>, title: 'Жирный (Ctrl+B)', run: (e) => e.chain().focus().toggleBold().run() },
  { key: 'italic', label: <i>I</i>, title: 'Курсив (Ctrl+I)', run: (e) => e.chain().focus().toggleItalic().run() },
  { key: 'underline', label: <u>U</u>, title: 'Подчёркнутый (Ctrl+U)', run: (e) => e.chain().focus().toggleUnderline().run() },
  { key: 'strike', label: <s>S</s>, title: 'Зачёркнутый', run: (e) => e.chain().focus().toggleStrike().run() },
  { key: 'bulletList', label: '•', title: 'Маркированный список', run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: 'orderedList', label: '1.', title: 'Нумерованный список', run: (e) => e.chain().focus().toggleOrderedList().run() },
];

/**
 * Редактор описания на Tiptap: жирный, курсив, подчёркивание, зачёркивание, списки, ссылки.
 * Начальный текст берётся один раз при создании; чтобы подставить другой, меняют key компонента.
 * Вставка всегда как простой текст: чужая разметка в описание не попадает.
 */
export function RichTextEditor({
  html,
  disabled,
  onChange,
  onBlur,
}: {
  html: string;
  disabled?: boolean;
  onChange: (html: string) => void;
  onBlur: () => void;
}) {
  // колбэки родителя меняются на каждом рендере; редактор должен видеть актуальные
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;

  const editorRef = useRef<Editor | null>(null);
  const [initialHtml] = useState(() => prepareHtml(html));

  const editor = useEditor({
    extensions: [
      // оставляем только ту разметку, которую разрешает sanitizeHtml
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: false,
          defaultProtocol: 'https',
          shouldAutoLink: (url) => /^https?:\/\//i.test(url),
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
        },
      }),
      Placeholder.configure({ placeholder: PLACEHOLDER }),
    ],
    content: initialHtml,
    editable: !disabled,
    editorProps: {
      attributes: {
        class: 'rich-field',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Описание',
      },
      handlePaste(_view, event) {
        const text = event.clipboardData?.getData('text/plain');
        if (text === undefined || text === null) return false;
        event.preventDefault();
        if (editorRef.current) insertPlainText(editorRef.current, text);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => onChangeRef.current(current.getHTML()),
    onBlur: () => onBlurRef.current(),
  });

  editorRef.current = editor;

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  function addLink() {
    if (!editor) return;
    const current = (editor.getAttributes('link').href as string | undefined) ?? '';
    const url = window.prompt('Адрес ссылки (начинается с https://)', current);
    if (url === null) return;
    const value = url.trim();
    if (!isValidUrl(value)) {
      window.alert('Нужна ссылка, которая начинается с http:// или https://');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
  }

  return (
    <div className="rich">
      <div className="rich-toolbar" role="toolbar" aria-label="Форматирование текста">
        {COMMANDS.map((c) => (
          <button
            key={c.key}
            type="button"
            title={c.title}
            aria-label={c.title}
            disabled={disabled || !editor}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (editor) c.run(editor);
            }}
          >
            {c.label}
          </button>
        ))}
        <button
          type="button"
          title="Ссылка"
          aria-label="Ссылка"
          disabled={disabled || !editor}
          onMouseDown={(e) => e.preventDefault()}
          onClick={addLink}
        >
          🔗
        </button>
      </div>
      <EditorContent editor={editor} className="rich-editor" />
    </div>
  );
}
