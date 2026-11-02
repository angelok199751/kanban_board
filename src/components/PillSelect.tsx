import { useEffect, useRef, useState } from 'react';
import type { PropertyOption } from '../lib/types';

/**
 * Выпадающий список, в котором значения выглядят цветными капсулами (как в старой версии).
 * Меню открывается поверх окна и не обрезается прокруткой области свойств.
 * multiple: можно выбрать несколько вариантов; каждая выбранная капсула убирается отдельно.
 */
export function PillSelect({
  options,
  value,
  onChange,
  disabled,
  label,
  multiple = false,
}: {
  options: PropertyOption[];
  value: string | string[] | null;
  onChange: (value: string | string[] | null) => void;
  disabled?: boolean;
  label: string;
  multiple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const selectedIds = multiple ? (Array.isArray(value) ? value : value === null ? [] : [value]) : [];
  const selectedOptions = multiple
    ? options.filter((o) => selectedIds.includes(o.id))
    : [];
  const selected = !multiple ? (options.find((o) => o.id === value) ?? null) : null;

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menu.current?.contains(target) || anchor.current?.contains(target)) return;
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
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, 190);
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 200 && above > below;
    setPos(
      up
        ? { left: r.left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(280, above) }
        : { left: r.left, width, top: r.bottom + 4, maxHeight: Math.min(280, below) },
    );
    setOpen(true);
  }

  function pick(id: string | null) {
    setOpen(false);
    if (id !== value) onChange(id);
    button.current?.focus();
  }

  function toggleOption(id: string) {
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    onChange(next.length > 0 ? next : null);
  }

  return (
    <div ref={anchor} className="pill-select">
      {multiple ? (
        <div className="pill-select-btn multi">
          <div className="pill-values">
            {selectedOptions.length === 0 ? (
              <button type="button" className="pill-empty pill-empty-btn" disabled={disabled} onClick={toggle}>
                Не выбрано
              </button>
            ) : (
              selectedOptions.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`pill c-${o.color} pill-removable`}
                  title={`Убрать «${o.label}»`}
                  aria-label={`Убрать «${o.label}»`}
                  disabled={disabled}
                  onClick={() => toggleOption(o.id)}
                >
                  {o.label}
                  <span className="pill-remove" aria-hidden="true">
                    ×
                  </span>
                </button>
              ))
            )}
          </div>
          <button
            ref={button}
            type="button"
            className="pill-caret-btn"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={label}
            disabled={disabled}
            onClick={toggle}
          >
            <span className="pill-caret" aria-hidden="true">
              ▾
            </span>
          </button>
        </div>
      ) : (
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
      )}

      {open && pos && (
        <div
          ref={menu}
          className="pill-menu"
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          style={pos}
        >
          {multiple ? (
            <>
              {selectedIds.length > 0 && (
                <button type="button" className="pill-option pill-clear" onClick={() => onChange(null)}>
                  <span className="pill-empty">Очистить все</span>
                </button>
              )}
              {options.map((o) => {
                const on = selectedIds.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className="pill-option pill-option-multi"
                    onClick={() => toggleOption(o.id)}
                  >
                    <span className={`pill c-${o.color}`}>{o.label}</span>
                    <span className="pill-check" aria-hidden="true">
                      {on ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
            </>
          ) : (
            <>
              <button type="button" role="option" aria-selected={value === null} className="pill-option" onClick={() => pick(null)}>
                <span className="pill-empty">Не выбрано</span>
              </button>
              {options.map((o) => (
                <button key={o.id} type="button" role="option" aria-selected={o.id === value} className="pill-option" onClick={() => pick(o.id)}>
                  <span className={`pill c-${o.color}`}>{o.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
