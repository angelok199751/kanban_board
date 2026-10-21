import { useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useActions } from '../features/boards/hooks';
import { PROPERTY_TYPE_LABELS } from '../lib/format';
import { useNotice } from '../lib/notice';
import { compareByPosition } from '../lib/positions';
import { humanizeError } from '../lib/supabase';
import type { Property, PropertyType } from '../lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';

const errText = (e: unknown) => humanizeError(e instanceof Error ? e.message : String(e));
const TYPES: PropertyType[] = ['select', 'text', 'url', 'date'];

function PropertyRow({
  property,
  onRename,
  onToggleHidden,
  onOptions,
  onArchive,
}: {
  property: Property;
  onRename: (name: string) => void;
  onToggleHidden: () => void;
  onOptions: () => void;
  onArchive: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: property.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'prop-row dragging' : 'prop-row'}>
      <button type="button" className="drag-handle" title="Перетащить" aria-label="Перетащить" {...attributes} {...listeners}>
        ⋮⋮
      </button>
      <input
        key={`${property.id}:${property.name}`}
        className="field"
        maxLength={60}
        defaultValue={property.name}
        aria-label="Название свойства"
        onBlur={(e) => onRename(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <span className="type-badge">{PROPERTY_TYPE_LABELS[property.type]}</span>
      {property.type === 'select' && (
        <button className="btn small" type="button" onClick={onOptions}>
          Варианты
        </button>
      )}
      <button
        type="button"
        className={property.hidden ? 'icon-btn off' : 'icon-btn'}
        title={property.hidden ? 'Скрыто на карточках: показать' : 'Показывается на карточках: скрыть'}
        aria-label={property.hidden ? 'Показать на карточках' : 'Скрыть на карточках'}
        onClick={onToggleHidden}
      >
        {property.hidden ? '🚫' : '👁'}
      </button>
      <button type="button" className="icon-btn" title="Убрать в архив" aria-label="Убрать в архив" onClick={onArchive}>
        🗄
      </button>
    </div>
  );
}

export function PropertiesDialog({
  boardId,
  properties,
  onOptions,
  onClose,
}: {
  boardId: string;
  properties: Property[];
  onOptions: (property: Property) => void;
  onClose: () => void;
}) {
  const actions = useActions();
  const { notify } = useNotice();
  const [toArchive, setToArchive] = useState<Property | null>(null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<PropertyType>('select');
  const [adding, setAdding] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const active = properties.filter((p) => p.archived_at === null).sort(compareByPosition);
  const archived = properties.filter((p) => p.archived_at !== null).sort(compareByPosition);
  const ids = active.map((p) => p.id);

  async function attempt(action: () => Promise<void>, failure: string) {
    try {
      await action();
    } catch (e) {
      notify(`${failure}: ${errText(e)}`);
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const { active: a, over } = e;
    if (!over || a.id === over.id) return;
    const from = ids.indexOf(String(a.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    void actions.moveProperty(boardId, String(a.id), arrayMove(ids, from, to));
  }

  async function add() {
    const name = newName.trim();
    if (name === '') return;
    setAdding(true);
    await attempt(async () => {
      await actions.createProperty(boardId, name, newType);
      setNewName('');
    }, 'Не удалось добавить свойство');
    setAdding(false);
  }

  return (
    <>
      <Dialog title="Свойства карточек" wide onClose={onClose}>
        <p className="muted small-note">
          Свойства общие для всех карточек доски. Значок глаза скрывает свойство с карточки на доске, но оно остаётся в
          окне карточки.
        </p>

        {active.length === 0 && <div className="muted">Свойств пока нет. Добавь первое ниже.</div>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="prop-list">
              {active.map((p) => (
                <PropertyRow
                  key={p.id}
                  property={p}
                  onRename={(name) => {
                    const value = name.trim();
                    if (value === p.name) return;
                    if (value === '') {
                      notify('Название свойства не может быть пустым.');
                      return;
                    }
                    void attempt(() => actions.renameProperty(boardId, p.id, value), 'Не удалось переименовать');
                  }}
                  onToggleHidden={() =>
                    void attempt(() => actions.setPropertyHidden(boardId, p.id, !p.hidden), 'Не удалось изменить видимость')
                  }
                  onOptions={() => onOptions(p)}
                  onArchive={() => setToArchive(p)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <div className="prop-add">
          <input
            className="field"
            placeholder="Название нового свойства"
            maxLength={60}
            value={newName}
            disabled={adding}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add();
            }}
          />
          <select className="field" value={newType} aria-label="Тип свойства" onChange={(e) => setNewType(e.target.value as PropertyType)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {PROPERTY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <button className="btn primary" type="button" disabled={adding || newName.trim() === ''} onClick={() => void add()}>
            Добавить
          </button>
        </div>
        <p className="muted small-note">Тип свойства выбирается при создании и потом не меняется, чтобы не потерять значения.</p>

        {archived.length > 0 && (
          <details className="archived">
            <summary>Архив свойств ({archived.length})</summary>
            {archived.map((p) => (
              <div key={p.id} className="prop-row">
                <span className="archived-name">{p.name}</span>
                <span className="type-badge">{PROPERTY_TYPE_LABELS[p.type]}</span>
                <button
                  className="btn small"
                  type="button"
                  onClick={() => void attempt(() => actions.setPropertyArchived(boardId, p.id, false), 'Не удалось вернуть свойство')}
                >
                  Вернуть
                </button>
              </div>
            ))}
          </details>
        )}

        <div className="row end">
          <button className="btn" type="button" onClick={onClose}>
            Готово
          </button>
        </div>
      </Dialog>

      {toArchive && (
        <ConfirmDialog
          title="Убрать свойство в архив?"
          confirmLabel="Убрать в архив"
          onConfirm={() => actions.setPropertyArchived(boardId, toArchive.id, true)}
          onClose={() => setToArchive(null)}
        >
          Свойство «{toArchive.name}» пропадёт с карточек и из окна карточки. Значения, которые уже заполнены, не удаляются:
          они вернутся, если восстановить свойство из архива.
        </ConfirmDialog>
      )}
    </>
  );
}
