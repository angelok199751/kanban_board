import { useEffect, useRef, type ReactNode } from 'react';
import { isValidUrl } from '../lib/format';
import { findUrls, linkifyDom, linkifyText } from '../lib/linkify';
import { sanitizeHtml } from '../lib/sanitize';

/** Позиция каретки в тексте редактора: нужна, чтобы после замены ссылок она осталась на месте. */
function caretOffset(root: HTMLElement, range: Range): number {
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

function restoreCaret(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = offset;
  let last: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    last = node;
    const length = node.nodeValue?.length ?? 0;
    if (left <= length) {
      const range = document.createRange();
      range.setStart(node, left);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    left -= length;
  }
  if (last) {
    const range = document.createRange();
    range.setStart(last, last.nodeValue?.length ?? 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}

const COMMANDS: { cmd: string; label: ReactNode; title: string }[] = [
  { cmd: 'bold', label: <b>B</b>, title: 'Жирный (Ctrl+B)' },
  { cmd: 'italic', label: <i>I</i>, title: 'Курсив (Ctrl+I)' },
  { cmd: 'underline', label: <u>U</u>, title: 'Подчёркнутый (Ctrl+U)' },
  { cmd: 'strikeThrough', label: <s>S</s>, title: 'Зачёркнутый' },
  { cmd: 'insertUnorderedList', label: '•', title: 'Маркированный список' },
  { cmd: 'insertOrderedList', label: '1.', title: 'Нумерованный список' },
];

/**
 * Редактор описания: жирный, курсив, подчёркивание, зачёркивание, списки, ссылки.
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
  const ref = useRef<HTMLDivElement>(null);
  const linkTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = sanitizeHtml(html);
      // уже сохранённые описания тоже показываем со ссылками; сохранятся они при следующей правке
      linkifyDom(ref.current);
    }
    // только при создании: дальше содержимое ведёт сам редактор
    return () => window.clearTimeout(linkTimer.current);
  }, []);

  const emit = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  function linkifyNow() {
    const editor = ref.current;
    if (!editor) return;
    const selection = window.getSelection();
    const range = selection && selection.rangeCount === 1 ? selection.getRangeAt(0) : null;
    const offset =
      range && range.collapsed && editor.contains(range.startContainer) ? caretOffset(editor, range) : null;
    if (linkifyDom(editor)) {
      if (offset !== null) restoreCaret(editor, offset);
      emit();
    }
  }

  function scheduleLinkify(delay: number) {
    window.clearTimeout(linkTimer.current);
    linkTimer.current = window.setTimeout(linkifyNow, delay);
  }

  function exec(cmd: string) {
    ref.current?.focus();
    document.execCommand(cmd);
    emit();
  }

  function addLink() {
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    const url = window.prompt('Адрес ссылки (начинается с https://)');
    if (url === null) return;
    const value = url.trim();
    if (!isValidUrl(value)) {
      window.alert('Нужна ссылка, которая начинается с http:// или https://');
      return;
    }
    ref.current?.focus();
    if (range && selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand('createLink', false, value);
    emit();
  }

  return (
    <div className="rich">
      <div className="rich-toolbar" role="toolbar" aria-label="Форматирование текста">
        {COMMANDS.map((c) => (
          <button
            key={c.cmd}
            type="button"
            title={c.title}
            aria-label={c.title}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(c.cmd)}
          >
            {c.label}
          </button>
        ))}
        <button type="button" title="Ссылка" aria-label="Ссылка" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={addLink}>
          🔗
        </button>
      </div>
      <div
        ref={ref}
        className="rich-field"
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-label="Описание"
        data-placeholder="Добавь описание: подробности, шаги воспроизведения, ссылки…"
        onInput={(e) => {
          emit();
          const data = (e.nativeEvent as InputEvent).data;
          // после пробела или знака ссылка уже закончилась; иначе ждём короткую паузу
          if (data === null || /[\s.,;:!?)\]}]$/.test(data)) scheduleLinkify(0);
          else scheduleLinkify(500);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') scheduleLinkify(0);
        }}
        onBlur={() => {
          window.clearTimeout(linkTimer.current);
          linkifyNow();
          onBlur();
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          if (findUrls(text).length > 0) {
            const html = linkifyText(text).replace(/\r?\n/g, '<br>');
            const inserted = document.execCommand('insertHTML', false, html);
            if (!inserted) document.execCommand('insertText', false, text);
          } else {
            document.execCommand('insertText', false, text);
          }
          emit();
        }}
      />
    </div>
  );
}
