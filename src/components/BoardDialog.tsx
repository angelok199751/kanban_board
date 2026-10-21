import { useState } from 'react';
import { FormDialog } from './Dialog';

export function BoardDialog({
  title,
  submitLabel,
  initialName = '',
  initialDescription = '',
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initialName?: string;
  initialDescription?: string;
  onSubmit: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  return (
    <FormDialog
      title={title}
      submitLabel={submitLabel}
      onClose={onClose}
      onSubmit={() => onSubmit(name, description)}
      disabled={name.trim() === ''}
    >
      <label className="label" htmlFor="boardName">Название</label>
      <input id="boardName" className="field" maxLength={100} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <label className="label" htmlFor="boardDesc">Описание (необязательно)</label>
      <textarea id="boardDesc" className="field" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
    </FormDialog>
  );
}
