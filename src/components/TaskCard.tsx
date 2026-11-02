import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { taskDndId } from '../lib/dndIds';
import type { CardField } from '../lib/cardFields';
import type { Task } from '../lib/types';

/** Цветная пилюля значения: список и дата цветные, текст серый, ссылка кликабельна. */
export function Pill({ field }: { field: CardField }) {
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  if (field.url) {
    return (
      <a
        className="pill link"
        href={field.url}
        target="_blank"
        rel="noopener noreferrer"
        title={field.url}
        onPointerDown={stop}
        onClick={stop}
      >
        {field.text} ↗
      </a>
    );
  }
  return (
    <span className={`pill c-${field.tone ?? 'gray'}`} title={field.name}>
      {field.text}
    </span>
  );
}

/** Внешний вид карточки (без перетаскивания): используется и в колонке, и в «призраке» при переносе. */
export function TaskCardView({
  task,
  fields,
  compact,
  className,
}: {
  task: Task;
  fields?: CardField[];
  compact?: boolean;
  className?: string;
}) {
  const classes = ['task', compact ? 'compact' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <article className={classes}>
      <div className="task-top">
        <span className="task-id">#{task.number}</span>
        <span className="task-open" aria-hidden="true">
          ↗
        </span>
      </div>
      <div className="task-title">{task.title}</div>
      {!compact && fields && fields.length > 0 && (
        <div className="task-meta">
          {fields.map((f) => (
            <Pill key={f.id} field={f} />
          ))}
        </div>
      )}
    </article>
  );
}

export function SortableTaskCard({
  task,
  fields,
  compact,
  onOpen,
}: {
  task: Task;
  fields: CardField[];
  compact: boolean;
  onOpen: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: taskDndId(task.id),
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'task-slot dragging' : 'task-slot'}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task)}
    >
      <TaskCardView task={task} fields={fields} compact={compact} />
    </div>
  );
}
