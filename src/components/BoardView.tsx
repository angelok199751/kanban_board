import { useMemo, useState } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useAuth } from '../auth/AuthProvider';
import { useActions, useBoardData, useSearchIds, useViews } from '../features/boards/hooks';
import { useViewState } from '../features/boards/useViewState';
import { COLORS } from '../lib/colors';
import { columnDndId, isColumnDndId, isTaskDndId, rawId } from '../lib/dndIds';
import { formatDate, hostOf, isValidUrl } from '../lib/format';
import { useNotice } from '../lib/notice';
import { mergeIntoFull } from '../lib/order';
import { compareByPosition } from '../lib/positions';
import { humanizeError } from '../lib/supabase';
import type { Board, Column, Property, SavedView, Task, TaskValue } from '../lib/types';
import { useDebounced } from '../lib/useDebounced';
import { countActiveFilters, isShownOnCard, matchesFilters, sortTasks, type ViewContext } from '../lib/viewConfig';
import { ColumnDialog } from './ColumnDialog';
import { ColumnView } from './ColumnView';
import { FieldsDialog } from './FieldsDialog';
import { FiltersDialog } from './FiltersDialog';
import { OptionsDialog } from './OptionsDialog';
import { PropertiesDialog } from './PropertiesDialog';
import { TaskCardView, type CardField } from './TaskCard';
import { TaskDialog } from './TaskDialog';
import { ManageViewDialog, SaveViewDialog } from './ViewDialog';
import { ViewBar } from './ViewBar';

type Order = Record<string, string[]>; // id колонки -> id карточек по порядку

type DialogState =
  | { kind: 'newColumn' }
  | { kind: 'editColumn'; column: Column }
  | { kind: 'task'; task: Task }
  | { kind: 'properties' }
  | { kind: 'options'; propertyId: string }
  | { kind: 'filters' }
  | { kind: 'fields' }
  | { kind: 'saveView' }
  | { kind: 'manageView'; view: SavedView }
  | null;

const cloneOrder = (o: Order): Order => {
  const copy: Order = {};
  for (const key of Object.keys(o)) copy[key] = [...o[key]];
  return copy;
};

const findContainer = (o: Order, taskId: string): string | undefined =>
  Object.keys(o).find((key) => o[key].includes(taskId));

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

const errText = (e: unknown) => humanizeError(e instanceof Error ? e.message : String(e));

/**
 * Выбор цели при перетаскивании. Колонка тянется только к другим колонкам.
 * Для карточки приоритет у карточки под курсором, иначе берётся колонка (карточка встанет в её конец).
 */
const collisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id);
  if (isColumnDndId(activeId)) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => isColumnDndId(String(c.id))),
    });
  }
  const pointer = pointerWithin(args);
  const hits = pointer.length > 0 ? pointer : rectIntersection(args);
  const taskHit = hits.find((h) => isTaskDndId(String(h.id)) && h.id !== args.active.id);
  if (taskHit) return [taskHit];
  const columnHit = hits.find((h) => isColumnDndId(String(h.id)));
  return columnHit ? [columnHit] : [];
};

export function BoardView({ board }: { board: Board }) {
  const query = useBoardData(board.id);
  const viewsQuery = useViews(board.id);
  const actions = useActions();
  const { notify } = useNotice();
  const { state: auth } = useAuth();
  const userId = auth.status === 'ready' ? auth.session.user.id : null;

  const [dialog, setDialog] = useState<DialogState>(null);
  const [dragOrder, setDragOrder] = useState<Order | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeColumn, setActiveColumn] = useState<Column | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const searchQuery = useSearchIds(board.id, debouncedSearch);

  // общие представления слева, личные справа; внутри группы по порядку создания
  const views = useMemo(() => {
    const all = [...(viewsQuery.data ?? [])].sort(compareByPosition);
    return [...all.filter((v) => v.owner_id === null), ...all.filter((v) => v.owner_id !== null)];
  }, [viewsQuery.data]);
  const view = useViewState(board.id, views, viewsQuery.isSuccess);
  const config = view.config;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ------------------------------------------------------------ данные доски
  const columns = useMemo(() => [...(query.data?.columns ?? [])].sort(compareByPosition), [query.data]);
  const tasks = useMemo(() => [...(query.data?.tasks ?? [])].sort(compareByPosition), [query.data]);
  const taskById = useMemo(() => new Map<string, Task>(tasks.map((t) => [t.id, t])), [tasks]);
  const columnById = useMemo(() => new Map<string, Column>(columns.map((c) => [c.id, c])), [columns]);

  const properties = useMemo(() => query.data?.properties ?? [], [query.data]);
  const options = useMemo(() => query.data?.options ?? [], [query.data]);
  const activeProperties = useMemo(
    () => properties.filter((p) => p.archived_at === null).sort(compareByPosition),
    [properties],
  );
  const propertyMap = useMemo(() => new Map(activeProperties.map((p) => [p.id, p] as const)), [activeProperties]);
  const optionById = useMemo(() => new Map(options.map((o) => [o.id, o] as const)), [options]);
  const valuesByTask = useMemo(() => {
    const byTask = new Map<string, Map<string, TaskValue>>();
    for (const v of query.data?.values ?? []) {
      let inner = byTask.get(v.task_id);
      if (!inner) {
        inner = new Map<string, TaskValue>();
        byTask.set(v.task_id, inner);
      }
      inner.set(v.property_id, v);
    }
    return byTask;
  }, [query.data]);

  const ctx: ViewContext = useMemo(
    () => ({ properties: propertyMap, options: optionById, valuesOf: (id) => valuesByTask.get(id) }),
    [propertyMap, optionById, valuesByTask],
  );

  // ------------------------------------------------------------ поиск, фильтры, сортировка
  const searching = debouncedSearch.trim() !== '';
  const searchIds = useMemo(() => {
    if (!searching) return null;
    const ids = new Set<string>(searchQuery.data ?? []);
    const asNumber = debouncedSearch.trim().replace(/^#/, '');
    if (/^\d+$/.test(asNumber)) for (const t of tasks) if (String(t.number) === asNumber) ids.add(t.id);
    return ids;
  }, [searching, searchQuery.data, debouncedSearch, tasks]);

  const visibleTasks = useMemo(
    () => tasks.filter((t) => (searchIds === null || searchIds.has(t.id)) && matchesFilters(t, config.filters, ctx)),
    [tasks, searchIds, config.filters, ctx],
  );

  // порядок «как в базе» (по position): нужен для сохранения переноса
  const fullOrder = useMemo(() => {
    const order: Order = {};
    for (const c of columns) order[c.id] = [];
    for (const t of tasks) order[t.column_id]?.push(t.id);
    return order;
  }, [columns, tasks]);

  // порядок на экране: после фильтров и сортировки
  const displayOrder = useMemo(() => {
    const order: Order = {};
    for (const c of columns) order[c.id] = [];
    for (const t of sortTasks(visibleTasks, config.sort, ctx)) order[t.column_id]?.push(t.id);
    return order;
  }, [columns, visibleTasks, config.sort, ctx]);

  const order = dragOrder ?? displayOrder;
  const filterCount = countActiveFilters(config, propertyMap);
  const manualSort = config.sort.key === 'manual';

  const tasksOf = (columnId: string): Task[] =>
    (order[columnId] ?? []).map((id) => taskById.get(id)).filter((t): t is Task => t !== undefined);

  /** Значения, которые показываются на карточке: только непустые и только у свойств, включённых в этом представлении. */
  const fieldsOf = (taskId: string): CardField[] => {
    const values = valuesByTask.get(taskId);
    if (!values) return [];
    const out: CardField[] = [];
    for (const p of activeProperties) {
      if (!isShownOnCard(p, config)) continue;
      const v = values.get(p.id);
      if (!v) continue;
      const base = { id: p.id, name: p.name, type: p.type };
      if (p.type === 'select') {
        const option = v.option_id ? optionById.get(v.option_id) : undefined;
        if (option) out.push({ ...base, text: option.label, color: COLORS[option.color] });
      } else if (p.type === 'date') {
        if (v.value_date) out.push({ ...base, text: formatDate(v.value_date) });
      } else if (p.type === 'url') {
        if (v.value_text) {
          out.push(
            isValidUrl(v.value_text)
              ? { ...base, text: hostOf(v.value_text), url: v.value_text }
              : { ...base, text: v.value_text },
          );
        }
      } else if (v.value_text) {
        out.push({ ...base, text: v.value_text });
      }
    }
    return out;
  };

  const optionsProperty: Property | null =
    dialog?.kind === 'options' ? (properties.find((p) => p.id === dialog.propertyId) ?? null) : null;

  // ------------------------------------------------------------ перетаскивание
  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    if (isTaskDndId(id)) {
      setActiveTask(taskById.get(rawId(id)) ?? null);
      setDragOrder(cloneOrder(displayOrder));
    } else if (isColumnDndId(id)) {
      setActiveColumn(columnById.get(rawId(id)) ?? null);
    }
  }

  // Пока карточку тянут над другой колонкой, показываем её уже там
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (!isTaskDndId(activeId)) return;
    const taskId = rawId(activeId);

    setDragOrder((prev) => {
      const cur = prev ?? displayOrder;
      const from = findContainer(cur, taskId);
      if (!from) return prev;

      let to: string | undefined;
      let index = 0;
      if (isColumnDndId(overId)) {
        to = rawId(overId);
        index = cur[to] ? cur[to].length : 0;
      } else if (isTaskDndId(overId)) {
        const overTaskId = rawId(overId);
        to = findContainer(cur, overTaskId);
        if (to) {
          const translated = active.rect.current.translated;
          const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
          index = cur[to].indexOf(overTaskId) + (below ? 1 : 0);
        }
      }
      if (!to || to === from || !cur[to]) return prev;

      const next = cloneOrder(cur);
      next[from] = next[from].filter((id) => id !== taskId);
      next[to].splice(index, 0, taskId);
      return next;
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const activeId = String(active.id);
    setActiveTask(null);
    setActiveColumn(null);

    // ---- колонка: меняем порядок колонок
    if (isColumnDndId(activeId)) {
      if (!over || !isColumnDndId(String(over.id)) || over.id === active.id) return;
      const ids = columns.map((c) => c.id);
      const from = ids.indexOf(rawId(activeId));
      const to = ids.indexOf(rawId(String(over.id)));
      if (from < 0 || to < 0) return;
      void actions.moveColumn(board.id, rawId(activeId), arrayMove(ids, from, to));
      return;
    }

    // ---- карточка
    const taskId = rawId(activeId);
    const cur = dragOrder ?? displayOrder;
    let finalOrder = cur;
    if (over && isTaskDndId(String(over.id))) {
      const overTaskId = rawId(String(over.id));
      const c1 = findContainer(cur, taskId);
      const c2 = findContainer(cur, overTaskId);
      if (c1 !== undefined && c1 === c2) {
        const from = cur[c1].indexOf(taskId);
        const to = cur[c1].indexOf(overTaskId);
        if (from !== to) finalOrder = { ...cur, [c1]: arrayMove(cur[c1], from, to) };
      }
    }

    const container = findContainer(finalOrder, taskId);
    const original = taskById.get(taskId);
    if (container === undefined || !original) {
      setDragOrder(null);
      return;
    }

    const visibleFinal = finalOrder[container];
    const full = fullOrder[container] ?? [];
    let orderedIds: string[];
    if (manualSort) {
      // ручной порядок: ставим карточку на выбранное место среди видимых, скрытые остаются на местах
      if (original.column_id === container && sameList(displayOrder[container] ?? [], visibleFinal)) {
        setDragOrder(null);
        return;
      }
      orderedIds = mergeIntoFull(full, visibleFinal, taskId);
    } else {
      // порядок внутри колонки задаёт сортировка: сохраняем только перенос в другую колонку (в её конец)
      if (original.column_id === container) {
        setDragOrder(null);
        return;
      }
      orderedIds = [...full.filter((id) => id !== taskId), taskId];
    }
    void actions.moveTask(board.id, taskId, container, orderedIds);
    setDragOrder(null);
  }

  function onDragCancel() {
    setActiveTask(null);
    setActiveColumn(null);
    setDragOrder(null);
  }

  // ------------------------------------------------------------ представления
  async function saveActiveView() {
    if (!view.activeView) return;
    try {
      await actions.updateView(board.id, view.activeView.id, { config });
    } catch (e) {
      notify(`Не удалось сохранить представление: ${errText(e)}`);
    }
  }

  async function saveViewAs(name: string, personal: boolean) {
    const created = await actions.createView(board.id, personal ? userId : null, name, config);
    view.select(created.id, true);
  }

  // ------------------------------------------------------------ вывод
  if (query.isLoading) return <div className="board-state muted">Загружаем доску…</div>;
  if (query.isError) {
    return (
      <div className="board-state">
        <div className="error">{query.error instanceof Error ? query.error.message : 'Не удалось загрузить доску'}</div>
        <button className="btn" type="button" onClick={() => void query.refetch()}>
          Повторить
        </button>
      </div>
    );
  }

  const sortOptions: { value: string; label: string }[] = [
    { value: 'manual', label: 'Вручную' },
    { value: 'number', label: 'Номер' },
    { value: 'title', label: 'Название' },
    ...activeProperties.map((p) => ({ value: p.id, label: p.name })),
  ];
  // если выбрана сортировка по исчезнувшему свойству, показываем «Вручную»
  const sortValue = sortOptions.some((o) => o.value === config.sort.key) ? config.sort.key : 'manual';

  return (
    <>
      <ViewBar
        views={views}
        activeId={view.activeId}
        dirty={view.dirty}
        onSelect={(id) => view.select(id)}
        onSave={() => void saveActiveView()}
        onSaveAs={() => setDialog({ kind: 'saveView' })}
        onReset={view.reset}
        onManage={(v) => setDialog({ kind: 'manageView', view: v })}
      />

      <div className="board-toolbar">
        <input
          className="field search"
          type="search"
          placeholder="Поиск по названию, номеру и описанию…"
          aria-label="Поиск по карточкам"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn small" type="button" onClick={() => setDialog({ kind: 'filters' })}>
          Фильтры{filterCount > 0 && <span className="badge">{filterCount}</span>}
        </button>
        <select
          className="field small"
          aria-label="Сортировка"
          value={sortValue}
          onChange={(e) => view.update({ sort: { key: e.target.value, dir: config.sort.dir } })}
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value === 'manual' ? 'Порядок: вручную' : `Сортировка: ${o.label}`}
            </option>
          ))}
        </select>
        <button
          className="btn small icon"
          type="button"
          disabled={sortValue === 'manual'}
          title="Направление сортировки"
          aria-label="Направление сортировки"
          onClick={() => view.update({ sort: { key: sortValue, dir: config.sort.dir === 'asc' ? 'desc' : 'asc' } })}
        >
          {config.sort.dir === 'asc' ? '↑' : '↓'}
        </button>
        <button
          className={config.compact ? 'btn small pressed' : 'btn small'}
          type="button"
          aria-pressed={config.compact}
          onClick={() => view.update({ compact: !config.compact })}
        >
          ▤ Компактно
        </button>
        <button className="btn small" type="button" onClick={() => setDialog({ kind: 'fields' })}>
          Поля
        </button>
        <button className="btn small" type="button" onClick={() => setDialog({ kind: 'properties' })}>
          ⚙ Свойства
        </button>
        {searching && searchQuery.isError && (
          <span className="error-inline small-text">Поиск не сработал: {errText(searchQuery.error)}</span>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="board-scroll">
          <SortableContext items={columns.map((c) => columnDndId(c.id))} strategy={horizontalListSortingStrategy}>
            <div className="columns">
              {columns.map((c) => (
                <ColumnView
                  key={c.id}
                  column={c}
                  tasks={tasksOf(c.id)}
                  fieldsOf={fieldsOf}
                  compact={config.compact}
                  onAddTask={(title) => actions.createTask(board.id, c.id, title)}
                  onEdit={() => setDialog({ kind: 'editColumn', column: c })}
                  onOpenTask={(task) => setDialog({ kind: 'task', task })}
                />
              ))}
              <button className="add-column" type="button" onClick={() => setDialog({ kind: 'newColumn' })}>
                ＋ Колонка
              </button>
              {columns.length === 0 && (
                <div className="muted empty-hint">Доска пустая. Добавь первую колонку, а затем карточки.</div>
              )}
            </div>
          </SortableContext>
        </div>

        <DragOverlay>
          {activeTask ? (
            <TaskCardView task={activeTask} compact={config.compact} className="overlay" />
          ) : activeColumn ? (
            <div className="column overlay">
              <header className="column-head">
                <h3>{activeColumn.name}</h3>
              </header>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {dialog?.kind === 'newColumn' && (
        <ColumnDialog
          title="Новая колонка"
          submitLabel="Создать"
          onSubmit={(name, color) => actions.createColumn(board.id, name, color)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'editColumn' && (
        <ColumnDialog
          title="Настройка колонки"
          submitLabel="Сохранить"
          initialName={dialog.column.name}
          initialColor={dialog.column.color}
          onSubmit={(name, color) => actions.updateColumn(board.id, dialog.column.id, name, color)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'task' && (
        <TaskDialog
          key={dialog.task.id}
          boardId={board.id}
          task={dialog.task}
          properties={activeProperties}
          options={options}
          values={Array.from(valuesByTask.get(dialog.task.id)?.values() ?? [])}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'properties' && (
        <PropertiesDialog
          boardId={board.id}
          properties={properties}
          onOptions={(p) => setDialog({ kind: 'options', propertyId: p.id })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'options' && optionsProperty && (
        <OptionsDialog
          boardId={board.id}
          property={optionsProperty}
          options={options.filter((o) => o.property_id === optionsProperty.id).sort(compareByPosition)}
          onClose={() => setDialog({ kind: 'properties' })}
        />
      )}
      {dialog?.kind === 'filters' && (
        <FiltersDialog
          properties={activeProperties}
          options={options}
          config={config}
          onChange={(filters) => view.update({ filters })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'fields' && (
        <FieldsDialog
          properties={activeProperties}
          config={config}
          onChange={(cardProps) => view.update({ cardProps })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'saveView' && <SaveViewDialog onSubmit={saveViewAs} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'manageView' && (
        <ManageViewDialog
          view={dialog.view}
          onRename={(name) => actions.updateView(board.id, dialog.view.id, { name })}
          onDelete={async () => {
            await actions.deleteView(board.id, dialog.view.id);
            if (view.activeId === dialog.view.id) view.select(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
