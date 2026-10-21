import type { ReactNode } from 'react';
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
