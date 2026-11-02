import { useEffect, useRef, useState } from 'react';
import type { PropertyOption } from '../lib/types';

/**
 * Выпадающий список, в котором значения выглядят цветными капсулами (как в старой версии).
 * Меню открывается поверх окна и не обрезается прокруткой области свойств.
 */
export function PillSelect({
  options,
  value,
  onChange,
  disabled,
  label,
}: {
  options: PropertyOption[];
  value: string | null;
  onChange: (optionId: string | null) => void;
  disabled?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menu.current?.contains(target) || button.current?.contains(target)) return;
      close();
    };
    // Esc закрывает только меню, а не всё окно карточки
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 200 && above > below;
    setPos(
      up
        ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(280, above) }
        : { left: r.left, width: r.width, top: r.bottom + 4, maxHeight: Math.min(280, below) },
    );
    setOpen(true);
  }

  function pick(id: string | null) {
    setOpen(false);
    if (id !== value) onChange(id);
    button.current?.focus();
  }

  return (
    <div className="pill-select">
      <button
        ref={button}
        type="button"
        className="pill-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={toggle}
      >
        {selected ? <span className={`pill c-${selected.color}`}>{selected.label}</span> : <span className="pill-empty">Не выбрано</span>}
        <span className="pill-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && pos && (
        <div ref={menu} className="pill-menu" role="listbox" aria-label={label} style={pos}>
          <button type="button" role="option" aria-selected={value === null} className="pill-option" onClick={() => pick(null)}>
            <span className="pill-empty">Не выбрано</span>
          </button>
          {options.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={o.id === value} className="pill-option" onClick={() => pick(o.id)}>
              <span className={`pill c-${o.color}`}>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
