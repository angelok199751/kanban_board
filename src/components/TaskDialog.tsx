import { useState } from 'react';
import type { Task } from '../lib/types';
import { FormDialog } from './Dialog';

/** Пока только название. Полный редактор (описание, свойства) появится на этапах 4 и 5. */
export function TaskDialog({
  task,
  onSave,
  onClose,
}: {
  task: Task;
  onSave: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);

  return (
    <FormDialog
      title={`Карточка #${task.number}`}
      submitLabel="Сохранить"
      onClose={onClose}
      onSubmit={() => onSave(title)}
      disabled={title.trim() === ''}
    >
      <label className="label" htmlFor="taskTitle">Название</label>
      <input id="taskTitle" className="field" maxLength={300} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
    </FormDialog>
  );
}
