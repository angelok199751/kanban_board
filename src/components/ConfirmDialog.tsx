import { useState, type ReactNode } from 'react';
import { FormDialog } from './Dialog';

/** Подтверждение необратимого или заметного действия. Пока действие не удалось, окно остаётся открытым с ошибкой. */
export function ConfirmDialog({
  title,
  confirmLabel,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <FormDialog title={title} submitLabel={confirmLabel} onClose={onClose} onSubmit={onConfirm}>
      <div className="confirm-text">{children}</div>
    </FormDialog>
  );
}

/**
 * Подтверждение окончательного удаления: пока не введено слово или название, кнопка не работает.
 * Так случайно, одним кликом, удалить навсегда не получится.
 */
export function DangerConfirmDialog({
  title,
  confirmLabel,
  phrase,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  phrase: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [typed, setTyped] = useState('');
  const matches = typed.trim().toLowerCase() === phrase.trim().toLowerCase();

  return (
    <FormDialog title={title} submitLabel={confirmLabel} onClose={onClose} onSubmit={onConfirm} disabled={!matches}>
      <div className="confirm-text">{children}</div>
      <label className="label" htmlFor="dangerPhrase">
        Чтобы подтвердить, введи «{phrase}»
      </label>
      <input
        id="dangerPhrase"
        className="field"
        autoFocus
        autoComplete="off"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
    </FormDialog>
  );
}
