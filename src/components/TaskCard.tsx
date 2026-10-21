import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { taskDndId } from '../lib/dndIds';
import type { Task } from '../lib/types';

/** Внешний вид карточки (без перетаскивания): используется и в колонке, и в «призраке» при переносе. */
export function TaskCardView({ task, className }: { task: Task; className?: string }) {
  return (
    <div className={className ? `task ${className}` : 'task'}>
      <span className="task-number">#{task.number}</span>
      <span className="task-title">{task.title}</span>
    </div>
  );
}

export function SortableTaskCard({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
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
      <TaskCardView task={task} />
    </div>
  );
}
