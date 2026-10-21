import { useState } from 'react';
import type { SavedView } from '../lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { FormDialog } from './Dialog';

/** Новое представление: название и кому оно доступно. */
export function SaveViewDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (name: string, personal: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [personal, setPersonal] = useState(true);

  return (
    <FormDialog
      title="Сохранить представление"
      submitLabel="Сохранить"
      onClose={onClose}
      onSubmit={() => onSubmit(name, personal)}
      disabled={name.trim() === ''}
    >
      <label className="label" htmlFor="viewName">Название</label>
      <input id="viewName" className="field" maxLength={60} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <div className="label">Кто видит</div>
      <label className="radio-line">
        <input type="radio" name="scope" checked={personal} onChange={() => setPersonal(true)} />
        Только я (личное)
      </label>
      <label className="radio-line">
        <input type="radio" name="scope" checked={!personal} onChange={() => setPersonal(false)} />
        Вся команда (общее)
      </label>
      <p className="muted small-note">Фильтры, сортировка, компактный вид и набор полей на карточке сохраняются вместе. Поиск не сохраняется.</p>
    </FormDialog>
  );
}

/** Переименование и удаление выбранного представления. */
export function ManageViewDialog({
  view,
  onRename,
  onDelete,
  onClose,
}: {
  view: SavedView;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(view.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <FormDialog
        title="Представление"
        submitLabel="Сохранить название"
        onClose={onClose}
        onSubmit={() => onRename(name)}
        disabled={name.trim() === '' || name.trim() === view.name}
      >
        <label className="label" htmlFor="viewRename">Название</label>
        <input id="viewRename" className="field" maxLength={60} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <p className="muted small-note">
          {view.owner_id === null ? 'Общее представление: его видит и может менять вся команда.' : 'Личное представление: его видишь только ты.'}
        </p>
        <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>
          Удалить представление
        </button>
      </FormDialog>

      {confirmDelete && (
        <ConfirmDialog title="Удалить представление?" confirmLabel="Удалить" onConfirm={onDelete} onClose={() => setConfirmDelete(false)}>
          Представление «{view.name}» будет удалено
          {view.owner_id === null ? ' у всей команды' : ''}. Карточки и их значения не затрагиваются.
        </ConfirmDialog>
      )}
    </>
  );
}
