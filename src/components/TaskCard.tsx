import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { taskDndId } from '../lib/dndIds';
import type { PropertyType, Task } from '../lib/types';

/** Готовое к показу значение свойства на карточке. */
export interface CardField {
  id: string;
  name: string;
  type: PropertyType;
  text: string;
  color?: string; // для списка: цвет варианта
  url?: string; // для ссылки: адрес
}

/** Внешний вид карточки (без перетаскивания): используется и в колонке, и в «призраке» при переносе. */
export function TaskCardView({ task, fields, className }: { task: Task; fields?: CardField[]; className?: string }) {
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div className={className ? `task ${className}` : 'task'}>
      <span className="task-number">#{task.number}</span>
      <span className="task-title">{task.title}</span>
      {fields && fields.length > 0 && (
        <div className="task-fields">
          {fields.map((f) => {
            if (f.type === 'select') {
              return (
                <span key={f.id} className="chip" style={{ color: f.color, background: `${f.color}26` }} title={f.name}>
                  {f.text}
                </span>
              );
            }
            if (f.type === 'url' && f.url) {
              return (
                <a
                  key={f.id}
                  className="chip link"
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={f.url}
                  onPointerDown={stop}
                  onClick={stop}
                >
                  {f.text} ↗
                </a>
              );
            }
            return (
              <span key={f.id} className="field-line">
                <span className="muted">{f.name}:</span> {f.text}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SortableTaskCard({
  task,
  fields,
  onOpen,
}: {
  task: Task;
  fields: CardField[];
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
      <TaskCardView task={task} fields={fields} />
    </div>
  );
}
