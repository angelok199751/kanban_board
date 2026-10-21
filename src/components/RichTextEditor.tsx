import { useEffect, useRef, type ReactNode } from 'react';
import { isValidUrl } from '../lib/format';
import { sanitizeHtml } from '../lib/sanitize';

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

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = sanitizeHtml(html);
    // только при создании: дальше содержимое ведёт сам редактор
  }, []);

  const emit = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

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
        onInput={emit}
        onBlur={onBlur}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
      />
    </div>
  );
}
