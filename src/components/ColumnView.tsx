import { useState, type FormEvent } from 'react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { COLORS } from '../lib/colors';
import { columnDndId, taskDndId } from '../lib/dndIds';
import { useNotice } from '../lib/notice';
import { humanizeError } from '../lib/supabase';
import type { Column, Task } from '../lib/types';
import { SortableTaskCard } from './TaskCard';

function AddTask({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const { notify } = useNotice();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = title.trim();
    if (value === '') return;
    setBusy(true);
    try {
      await onAdd(value);
      setTitle('');
    } catch (err) {
      notify(`Не удалось создать карточку: ${humanizeError(err instanceof Error ? err.message : String(err))}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="add-task" type="button" onClick={() => setOpen(true)}>
        ＋ Добавить карточку
      </button>
    );
  }

  return (
    <form className="add-task-form" onSubmit={submit}>
      <input
        className="field"
        placeholder="Название карточки"
        maxLength={300}
        autoFocus
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <div className="row">
        <button className="btn primary small" type="submit" disabled={busy || title.trim() === ''}>
          Добавить
        </button>
        <button className="btn small" type="button" onClick={() => setOpen(false)}>
          Закрыть
        </button>
      </div>
    </form>
  );
}

export function ColumnView({
  column,
  tasks,
  onAddTask,
  onEdit,
  onOpenTask,
}: {
  column: Column;
  tasks: Task[];
  onAddTask: (title: string) => Promise<void>;
  onEdit: () => void;
  onOpenTask: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: columnDndId(column.id),
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <section ref={setNodeRef} style={style} className={isDragging ? 'column dragging' : 'column'}>
      {/* Колонку можно тянуть только за заголовок: это меняет порядок колонок, а не статус карточек */}
      <header className="column-head" {...attributes} {...listeners}>
        <span className="dot" style={{ background: COLORS[column.color] }} />
        <h3 title={column.name}>{column.name}</h3>
        <span className="count">{tasks.length}</span>
        <button
          className="icon-btn"
          type="button"
          title="Настроить колонку"
          aria-label="Настроить колонку"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onEdit}
        >
          ⋯
        </button>
      </header>

      <SortableContext items={tasks.map((t) => taskDndId(t.id))} strategy={verticalListSortingStrategy}>
        <div className="cards">
          {tasks.map((t) => (
            <SortableTaskCard key={t.id} task={t} onOpen={onOpenTask} />
          ))}
        </div>
      </SortableContext>

      <AddTask onAdd={onAddTask} />
    </section>
  );
}
