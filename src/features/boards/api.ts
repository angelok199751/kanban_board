import { likePattern } from '../../lib/search';
import { supabase } from '../../lib/supabase';
import type {
  Board,
  BoardData,
  ColorName,
  Column,
  Property,
  PropertyOption,
  PropertyType,
  SavedView,
  Task,
  TaskFull,
  TaskValue,
} from '../../lib/types';

/** Карточку изменил кто-то другой (или она удалена): сохранение с устаревшей версией. */
export class ConflictError extends Error {
  constructor() {
    super('Карточку уже изменил кто-то другой или она удалена. Закрой окно, обнови доску и открой карточку заново.');
    this.name = 'ConflictError';
  }
}

const BOARD_FIELDS = 'id, name, description, position, archived_at';
const COLUMN_FIELDS = 'id, board_id, name, color, position, archived_at';
const TASK_FIELDS = 'id, board_id, column_id, number, title, position, version, archived_at, deleted_at';
const PROPERTY_FIELDS = 'id, board_id, name, type, position, hidden, archived_at';
const OPTION_FIELDS = 'id, property_id, label, color, position';
const VALUE_FIELDS = 'task_id, property_id, value_text, value_date, option_id';

type RawResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function run<T>(query: RawResult): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (data === null) throw new Error('Сервер вернул пустой ответ');
  return data as T;
}

/** Сервер отдаёт не больше 1000 строк за запрос, поэтому читаем страницами. */
async function fetchAll<T>(build: (from: number, to: number) => RawResult): Promise<T[]> {
  const size = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += size) {
    const rows = await run<T[]>(build(from, from + size - 1));
    all.push(...rows);
    if (rows.length < size) break;
  }
  return all;
}

// ---------------------------------------------------------------- доски

export function listBoards(): Promise<Board[]> {
  return run<Board[]>(
    supabase.from('boards').select(BOARD_FIELDS).is('archived_at', null).order('position'),
  );
}

export function createBoard(input: { name: string; description: string | null; position: string }): Promise<Board> {
  return run<Board>(supabase.from('boards').insert(input).select(BOARD_FIELDS).single());
}

export function updateBoard(id: string, patch: { name?: string; description?: string | null }): Promise<Board> {
  return run<Board>(supabase.from('boards').update(patch).eq('id', id).select(BOARD_FIELDS).single());
}

// ---------------------------------------------------------------- содержимое доски

export async function getBoardData(boardId: string): Promise<BoardData> {
  const [columns, tasks, properties, values] = await Promise.all([
    run<Column[]>(
      supabase
        .from('board_columns')
        .select(COLUMN_FIELDS)
        .eq('board_id', boardId)
        .is('archived_at', null)
        .order('position'),
    ),
    fetchAll<Task>((from, to) =>
      supabase
        .from('tasks')
        .select(TASK_FIELDS)
        .eq('board_id', boardId)
        .is('archived_at', null)
        .is('deleted_at', null)
        .order('position')
        .order('id')
        .range(from, to),
    ),
    run<Property[]>(
      supabase.from('properties').select(PROPERTY_FIELDS).eq('board_id', boardId).order('position'),
    ),
    // значения всех задач доски; связь с tasks нужна только для фильтра по доске
    fetchAll<TaskValue & { tasks?: unknown }>((from, to) =>
      supabase
        .from('task_values')
        .select(`${VALUE_FIELDS}, tasks!inner(board_id)`)
        .eq('tasks.board_id', boardId)
        .order('task_id')
        .order('property_id')
        .range(from, to),
    ),
  ]);

  const propertyIds = properties.map((p) => p.id);
  const options =
    propertyIds.length === 0
      ? []
      : await run<PropertyOption[]>(
          supabase.from('property_options').select(OPTION_FIELDS).in('property_id', propertyIds).order('position'),
        );

  return {
    columns,
    tasks,
    properties,
    options,
    values: values.map((v) => ({
      task_id: v.task_id,
      property_id: v.property_id,
      value_text: v.value_text,
      value_date: v.value_date,
      option_id: v.option_id,
    })),
  };
}

// ---------------------------------------------------------------- колонки

export function createColumn(input: {
  board_id: string;
  name: string;
  color: ColorName;
  position: string;
}): Promise<Column> {
  return run<Column>(supabase.from('board_columns').insert(input).select(COLUMN_FIELDS).single());
}

export function updateColumn(
  id: string,
  patch: { name?: string; color?: ColorName; position?: string },
): Promise<Column> {
  return run<Column>(supabase.from('board_columns').update(patch).eq('id', id).select(COLUMN_FIELDS).single());
}

// ---------------------------------------------------------------- задачи

export function createTask(input: {
  board_id: string;
  column_id: string;
  title: string;
  position: string;
}): Promise<Task> {
  return run<Task>(supabase.from('tasks').insert(input).select(TASK_FIELDS).single());
}

/**
 * Обновляет задачу. Если передан expectedVersion, обновление пройдёт только
 * при совпадении версии: иначе кто-то успел изменить задачу раньше (ConflictError).
 */
export async function updateTask(
  id: string,
  patch: { title?: string; column_id?: string; position?: string },
  expectedVersion?: number,
): Promise<Task> {
  let query = supabase.from('tasks').update(patch).eq('id', id);
  if (expectedVersion !== undefined) query = query.eq('version', expectedVersion);
  const rows = await run<Task[]>(query.select(TASK_FIELDS));
  if (rows.length === 0) throw new ConflictError();
  return rows[0];
}

// ---------------------------------------------------------------- свойства

export function createProperty(input: {
  board_id: string;
  name: string;
  type: PropertyType;
  position: string;
}): Promise<Property> {
  return run<Property>(supabase.from('properties').insert(input).select(PROPERTY_FIELDS).single());
}

export function updateProperty(
  id: string,
  patch: { name?: string; hidden?: boolean; position?: string; archived_at?: string | null },
): Promise<Property> {
  return run<Property>(supabase.from('properties').update(patch).eq('id', id).select(PROPERTY_FIELDS).single());
}

export function createOption(input: {
  property_id: string;
  label: string;
  color: ColorName;
  position: string;
}): Promise<PropertyOption> {
  return run<PropertyOption>(supabase.from('property_options').insert(input).select(OPTION_FIELDS).single());
}

export function updateOption(id: string, patch: { label?: string; color?: ColorName }): Promise<PropertyOption> {
  return run<PropertyOption>(supabase.from('property_options').update(patch).eq('id', id).select(OPTION_FIELDS).single());
}

/** Удаляет вариант. Если он где-то выбран, сначала нужно очистить эти значения (clearOptionValues). */
export async function deleteOption(id: string): Promise<void> {
  await run<unknown[]>(supabase.from('property_options').delete().eq('id', id).select('id'));
}

export async function clearOptionValues(optionId: string): Promise<void> {
  await run<unknown[]>(supabase.from('task_values').delete().eq('option_id', optionId).select('task_id'));
}

// ---------------------------------------------------------------- значения свойств

export function upsertValue(value: TaskValue): Promise<TaskValue> {
  return run<TaskValue>(
    supabase
      .from('task_values')
      .upsert(value, { onConflict: 'task_id,property_id' })
      .select(VALUE_FIELDS)
      .single(),
  );
}

export async function deleteValue(taskId: string, propertyId: string): Promise<void> {
  await run<unknown[]>(
    supabase.from('task_values').delete().eq('task_id', taskId).eq('property_id', propertyId).select('task_id'),
  );
}

// ---------------------------------------------------------------- полная карточка и поиск

/** Свежая карточка с описанием: окно редактирования берёт версию отсюда, а не из списка доски. */
export async function getTaskFull(id: string): Promise<TaskFull | null> {
  const rows = await run<TaskFull[]>(
    supabase.from('tasks').select('id, title, description_html, version').eq('id', id).is('deleted_at', null),
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function saveTask(
  id: string,
  patch: { title?: string; description_html?: string },
  expectedVersion: number,
): Promise<Task> {
  const rows = await run<Task[]>(
    supabase.from('tasks').update(patch).eq('id', id).eq('version', expectedVersion).select(TASK_FIELDS),
  );
  if (rows.length === 0) throw new ConflictError();
  return rows[0];
}

/** Id карточек доски, в названии или описании которых есть строка (без учёта регистра). */
export async function searchTaskIds(boardId: string, query: string): Promise<string[]> {
  const pattern = likePattern(query.trim());
  const rows = await fetchAll<{ id: string }>((from, to) =>
    supabase
      .from('tasks')
      .select('id')
      .eq('board_id', boardId)
      .is('archived_at', null)
      .is('deleted_at', null)
      .or(`title.ilike.${pattern},search_text.ilike.${pattern}`)
      .order('id')
      .range(from, to),
  );
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------- представления

const VIEW_FIELDS = 'id, board_id, owner_id, name, config, position';

export function listViews(boardId: string): Promise<SavedView[]> {
  return run<SavedView[]>(supabase.from('views').select(VIEW_FIELDS).eq('board_id', boardId).order('position'));
}

export function createView(input: {
  board_id: string;
  owner_id: string | null;
  name: string;
  config: unknown;
  position: string;
}): Promise<SavedView> {
  return run<SavedView>(supabase.from('views').insert(input).select(VIEW_FIELDS).single());
}

export function updateView(id: string, patch: { name?: string; config?: unknown }): Promise<SavedView> {
  return run<SavedView>(supabase.from('views').update(patch).eq('id', id).select(VIEW_FIELDS).single());
}

export async function deleteView(id: string): Promise<void> {
  await run<unknown[]>(supabase.from('views').delete().eq('id', id).select('id'));
}
