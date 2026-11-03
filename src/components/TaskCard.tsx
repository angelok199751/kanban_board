import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { COLORS } from '../lib/colors';
import { taskDndId } from '../lib/dndIds';
import type { CardField } from '../lib/cardFields';
import type { Column, Task } from '../lib/types';
import { IconTrash } from './Icons';

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
  action,
}: {
  task: Task;
  fields?: CardField[];
  compact?: boolean;
  className?: string;
  action?: ReactNode;
}) {
  const classes = ['task', compact ? 'compact' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <article className={classes}>
      <div className="task-top">
        <span className="task-id">#{task.number}</span>
        <span className="task-actions">
          {action}
          <span className="task-open" aria-hidden="true">
            ↗
          </span>
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

/**
 * Меню карточки: перемещение по колонкам этой доски, копия и корзина.
 * События не доходят до карточки, поэтому меню не открывает её и не начинает перетаскивание.
 * Меню рисуется поверх страницы, чтобы его не обрезали прокрутка и transform карточки.
 */
function TaskMenu({
  task,
  columns,
  onMove,
  onCopy,
  onDelete,
}: {
  task: Task;
  columns: Column[];
  onMove: (task: Task, columnId: string) => void;
  onCopy: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'main' | 'move'>('main');
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const targets = columns.filter((c) => c.id !== task.column_id);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menu.current?.contains(target) || button.current?.contains(target)) return;
      close();
    };
    // Esc закрывает только меню, а не окно карточки
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      button.current?.focus();
    };
    // Прокрутка доски уводит кнопку с места: меню закрывается (прокрутка внутри меню её не закрывает).
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && menu.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const width = 210;
    const below = window.innerHeight - r.bottom - 10;
    const above = r.top - 10;
    const up = below < 190 && above > below;
    setPos(
      up
        ? {
            left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
            width,
            bottom: window.innerHeight - r.top + 6,
            maxHeight: Math.min(340, above),
          }
        : {
            left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
            width,
            top: r.bottom + 6,
            maxHeight: Math.min(340, below),
          },
    );
    setMode('main');
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-btn task-menu-btn"
        title="Действия с карточкой"
        aria-label={`Действия с карточкой #${task.number}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={stop}
        onKeyDown={stop}
        onClick={(e) => {
          stop(e);
          toggle();
        }}
      >
        ⋯
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            className="task-menu"
            role="menu"
            aria-label={`Действия с карточкой #${task.number}`}
            style={pos}
            onPointerDown={stop}
            onClick={stop}
            onKeyDown={stop}
          >
            {mode === 'main' ? (
              <>
                <button
                  className="task-menu-item"
                  type="button"
                  role="menuitem"
                  disabled={targets.length === 0}
                  onClick={() => setMode('move')}
                >
                  <span>Переместить</span>
                  <span className="task-menu-arrow" aria-hidden="true">
                    ▸
                  </span>
                </button>
                <button
                  className="task-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    onCopy(task);
                  }}
                >
                  Копировать
                </button>
                <div className="task-menu-sep" />
                <button
                  className="task-menu-item danger"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    onDelete(task);
                  }}
                >
                  <IconTrash size={14} />
                  <span>В корзину</span>
                </button>
              </>
            ) : (
              <>
                <button className="task-menu-item" type="button" role="menuitem" onClick={() => setMode('main')}>
                  <span aria-hidden="true">←</span>
                  <span>Назад</span>
                </button>
                <div className="task-menu-label">Переместить в колонку</div>
                {targets.length === 0 ? (
                  <span className="task-menu-empty">Других колонок нет</span>
                ) : (
                  targets.map((c) => (
                    <button
                      key={c.id}
                      className="task-menu-item"
                      type="button"
                      role="menuitem"
                      title={c.name}
                      onClick={() => {
                        close();
                        onMove(task, c.id);
                      }}
                    >
                      <span className="dot" style={{ background: COLORS[c.color] }} />
                      <span className="task-menu-name">{c.name}</span>
                    </button>
                  ))
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

export function SortableTaskCard({
  task,
  fields,
  compact,
  columns,
  onOpen,
  onMove,
  onCopy,
  onDelete,
}: {
  task: Task;
  fields: CardField[];
  compact: boolean;
  columns: Column[];
  onOpen: (task: Task) => void;
  onMove: (task: Task, columnId: string) => void;
  onCopy: (task: Task) => void;
  onDelete: (task: Task) => void;
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
      <TaskCardView
        task={task}
        fields={fields}
        compact={compact}
        action={<TaskMenu task={task} columns={columns} onMove={onMove} onCopy={onCopy} onDelete={onDelete} />}
      />
    </div>
  );
}
