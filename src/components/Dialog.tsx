import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { humanizeError } from '../lib/supabase';

// Esc закрывает только верхний из открытых диалогов
const openDialogs: number[] = [];
let nextDialogId = 1;

export function Dialog({
  title,
  onClose,
  wide,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const idRef = useRef(0);

  useEffect(() => {
    const id = nextDialogId++;
    idRef.current = id;
    openDialogs.push(id);
    return () => {
      const i = openDialogs.indexOf(id);
      if (i >= 0) openDialogs.splice(i, 1);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openDialogs[openDialogs.length - 1] === idRef.current) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'card dialog wide' : 'card dialog'} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Диалог с формой: показывает ошибку сохранения и не закрывается, пока сохранение не удалось. */
export function FormDialog({
  title,
  submitLabel,
  onClose,
  onSubmit,
  disabled,
  children,
}: {
  title: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      onClose();
    } catch (err) {
      setError(humanizeError(err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        {children}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="row end">
          <button className="btn" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" type="submit" disabled={busy || disabled}>
            {busy ? 'Сохраняем…' : submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
