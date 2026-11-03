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
import { plural } from '../lib/format';
import type { Property, PropertyOption, PropertyType, TaskValue } from '../lib/types';
import { ConfirmDialog, DangerConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { IconArchive } from './Icons';
import { OptionsPanel } from './OptionsDialog';

const errText = (e: unknown) => humanizeError(e instanceof Error ? e.message : String(e));
const TYPES: PropertyType[] = ['select', 'text', 'url', 'date'];

function PropertyRow({
  property,
  onRename,
  onToggleHidden,
  onToggleMultiple,
  onOptions,
  onArchive,
}: {
  property: Property;
  onRename: (name: string) => void;
  onToggleHidden: () => void;
  onToggleMultiple: () => void;
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
      {property.type === 'select' ? (
        <label
          className="prop-multi"
          title={
            property.multiple
              ? 'В карточке можно выбрать несколько вариантов'
              : 'В карточке выбирается один вариант: включи, если нужно несколько'
          }
        >
          <input type="checkbox" checked={property.multiple} onChange={onToggleMultiple} />
          <span>несколько</span>
        </label>
      ) : (
        <span aria-hidden="true" />
      )}
      {property.type === 'select' ? (
        <button className="btn small" type="button" onClick={onOptions}>
          Варианты
        </button>
      ) : (
        <span aria-hidden="true" />
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
        <IconArchive />
      </button>
    </div>
  );
}

export function PropertiesDialog({
  boardId,
  properties,
  options,
  values,
  onClose,
}: {
  boardId: string;
  properties: Property[];
  options: PropertyOption[];
  values: TaskValue[];
  onClose: () => void;
}) {
  const actions = useActions();
  const { notify } = useNotice();
  const [optionsFor, setOptionsFor] = useState<Property | null>(null);
  const [toArchive, setToArchive] = useState<Property | null>(null);
  const [toDelete, setToDelete] = useState<Property | null>(null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<PropertyType>('select');
  const [newMultiple, setNewMultiple] = useState(false);
  const [adding, setAdding] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const active = properties.filter((p) => p.archived_at === null).sort(compareByPosition);
  const archived = properties.filter((p) => p.archived_at !== null).sort(compareByPosition);
  // панель вариантов открыта поверх списка: берём актуальную версию свойства после каждого сохранения
  const optionsProperty = optionsFor ? (properties.find((p) => p.id === optionsFor.id) ?? optionsFor) : null;
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
      await actions.createProperty(boardId, name, newType, newType === 'select' && newMultiple);
      setNewName('');
      setNewMultiple(false);
    }, 'Не удалось добавить свойство');
    setAdding(false);
  }

  return (
    <>
      <Dialog title={optionsProperty ? `Варианты: ${optionsProperty.name}` : 'Свойства карточек'} wide onClose={onClose}>
        {optionsProperty ? (
          <OptionsPanel
            boardId={boardId}
            property={optionsProperty}
            options={options.filter((o) => o.property_id === optionsProperty.id).sort(compareByPosition)}
            onBack={() => setOptionsFor(null)}
          />
        ) : (
          <>
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
                  onToggleMultiple={() =>
                    void attempt(
                      () => actions.setPropertyMultiple(boardId, p.id, !p.multiple),
                      'Не удалось изменить режим списка',
                    )
                  }
                  onOptions={() => setOptionsFor(p)}
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
          <select
            className="field"
            value={newType}
            aria-label="Тип свойства"
            onChange={(e) => {
              setNewType(e.target.value as PropertyType);
              if (e.target.value !== 'select') setNewMultiple(false);
            }}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {PROPERTY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          {newType === 'select' && (
            <label className="check-line prop-new-multi" title="Разрешить выбирать несколько вариантов в карточке">
              <input type="checkbox" checked={newMultiple} onChange={(e) => setNewMultiple(e.target.checked)} />
              <span>Несколько</span>
            </label>
          )}
          <button className="btn primary" type="button" disabled={adding || newName.trim() === ''} onClick={() => void add()}>
            Добавить
          </button>
        </div>
        <p className="muted small-note">Тип свойства выбирается при создании и потом не меняется, чтобы не потерять значения.</p>

        {archived.length > 0 && (
          <details className="archived">
            <summary>Архив свойств ({archived.length})</summary>
            {archived.map((p) => (
              <div key={p.id} className="prop-row archived">
                <span className="archived-name">{p.name}</span>
                <span className="type-badge">{PROPERTY_TYPE_LABELS[p.type]}</span>
                <button
                  className="btn small"
                  type="button"
                  onClick={() => void attempt(() => actions.setPropertyArchived(boardId, p.id, false), 'Не удалось вернуть свойство')}
                >
                  Вернуть
                </button>
                <button className="btn small danger" type="button" onClick={() => setToDelete(p)}>
                  Удалить навсегда
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
          </>
        )}
      </Dialog>

      {toDelete && (
        <DangerConfirmDialog
          title="Удалить свойство навсегда?"
          confirmLabel="Удалить свойство и значения"
          phrase={toDelete.name}
          onConfirm={() => actions.deletePropertyForever(boardId, toDelete.id)}
          onClose={() => setToDelete(null)}
        >
          {(() => {
            const filled = values.filter((v) => v.property_id === toDelete.id).length;
            const variants = options.filter((o) => o.property_id === toDelete.id).length;
            return (
              <>
                Свойство «{toDelete.name}» будет удалено вместе со всеми значениями: {filled}{' '}
                {plural(filled, 'заполненное значение', 'заполненных значения', 'заполненных значений')} в карточках
                {toDelete.type === 'select' ? ` и ${variants} ${plural(variants, 'вариант', 'варианта', 'вариантов')} списка` : ''}{' '}
                (включая архивные карточки и корзину). Сами карточки останутся. Восстановить удалённое будет невозможно.
              </>
            );
          })()}
        </DangerConfirmDialog>
      )}
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
