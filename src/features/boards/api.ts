import type { ArchiveData, ArchiveTask } from '../../lib/archive';
import { likePattern } from '../../lib/search';
import { supabase } from '../../lib/supabase';
import { normalizeStructure, type BoardTemplate, type BoardTemplateStructure } from '../../lib/templates';
import type {
  Board,
  BoardData,
  ColorName,
  Column,
  ArticleFull,
  ExportTask,
  KnowledgeArticle,
  KnowledgeBase,
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
  constructor(message = 'Карточку уже изменил кто-то другой или она удалена. Закрой окно, обнови доску и открой карточку заново.') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Значение свойства уже изменил или удалил другой участник: сохранять поверх нельзя, пока человек не решит. */
export class ValueConflictError extends Error {
  constructor() {
    super('Значение уже изменил другой участник.');
    this.name = 'ValueConflictError';
  }
}

const BOARD_FIELDS = 'id, name, description, position, archived_at';
const TEMPLATE_FIELDS = 'id, name, structure, created_at, updated_at';
const COLUMN_FIELDS = 'id, board_id, name, color, position, archived_at';
const TASK_FIELDS = 'id, board_id, column_id, number, title, position, version, archived_at, deleted_at';
const PROPERTY_FIELDS = 'id, board_id, name, type, multiple, position, hidden, archived_at';
const OPTION_FIELDS = 'id, property_id, label, color, position';
const VALUE_FIELDS = 'task_id, property_id, value_text, value_date, option_id, option_ids, updated_at';

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

export function updateBoard(
  id: string,
  patch: { name?: string; description?: string | null; archived_at?: string | null },
): Promise<Board> {
  return run<Board>(supabase.from('boards').update(patch).eq('id', id).select(BOARD_FIELDS).single());
}

// ---------------------------------------------------------------- шаблоны

const asTemplate = (row: BoardTemplate): BoardTemplate => ({
  ...row,
  structure: normalizeStructure(row.structure),
});

export async function listBoardTemplates(): Promise<BoardTemplate[]> {
  const rows = await run<BoardTemplate[]>(
    supabase.from('board_templates').select(TEMPLATE_FIELDS).order('name'),
  );
  return rows.map(asTemplate);
}

export async function createBoardTemplate(input: {
  name: string;
  structure: BoardTemplateStructure;
}): Promise<BoardTemplate> {
  const row = await run<BoardTemplate>(
    supabase
      .from('board_templates')
      .insert({ name: input.name.trim(), structure: normalizeStructure(input.structure) })
      .select(TEMPLATE_FIELDS)
      .single(),
  );
  return asTemplate(row);
}

export async function updateBoardTemplate(
  id: string,
  patch: { name?: string; structure?: BoardTemplateStructure },
): Promise<BoardTemplate> {
  const next =
    patch.structure === undefined
      ? { ...patch, name: patch.name?.trim() }
      : { ...patch, name: patch.name?.trim(), structure: normalizeStructure(patch.structure) };
  const row = await run<BoardTemplate>(
    supabase.from('board_templates').update(next).eq('id', id).select(TEMPLATE_FIELDS).single(),
  );
  return asTemplate(row);
}

export async function deleteBoardTemplate(id: string): Promise<void> {
  await run<unknown[]>(supabase.from('board_templates').delete().eq('id', id).select('id'));
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
      option_ids: v.option_ids ?? [],
      updated_at: v.updated_at,
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
  multiple?: boolean;
  position: string;
}): Promise<Property> {
  return run<Property>(supabase.from('properties').insert(input).select(PROPERTY_FIELDS).single());
}

export function updateProperty(
  id: string,
  patch: { name?: string; hidden?: boolean; multiple?: boolean; position?: string; archived_at?: string | null },
): Promise<Property> {
  return run<Property>(supabase.from('properties').update(patch).eq('id', id).select(PROPERTY_FIELDS).single());
}

/** Переключает режим списка и заодно приводит уже сохранённые значения к новому виду. */
export async function setPropertyMultiple(propertyId: string, multiple: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_property_multiple', {
    p_property_id: propertyId,
    p_multiple: multiple,
  });
  if (error) throw new Error(error.message);
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
  // Учитывает и одиночные option_id, и массивы option_ids.
  const { error } = await supabase.rpc('clear_option_values', { p_option_id: optionId });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- значения свойств

export type NewValue = Omit<TaskValue, 'updated_at'>;

/** Запись поверх, что бы там ни лежало (осознанное «оставить моё»). */
export function upsertValue(value: NewValue): Promise<TaskValue> {
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

/**
 * Сохранение «если значение не менялось с тех пор, как мы его видели».
 * existing: что мы видели (undefined, если значения не было). Иначе ValueConflictError.
 */
export async function saveValueChecked(existing: TaskValue | undefined, next: NewValue): Promise<TaskValue> {
  if (existing) {
    const rows = await run<TaskValue[]>(
      supabase
        .from('task_values')
        .update({
          value_text: next.value_text,
          value_date: next.value_date,
          option_id: next.option_id,
          option_ids: next.option_ids,
        })
        .eq('task_id', next.task_id)
        .eq('property_id', next.property_id)
        .eq('updated_at', existing.updated_at)
        .select(VALUE_FIELDS),
    );
    if (rows.length === 0) throw new ValueConflictError();
    return rows[0];
  }
  const { data, error } = await supabase.from('task_values').insert(next).select(VALUE_FIELDS).single();
  if (error) {
    if (error.code === '23505') throw new ValueConflictError(); // кто-то успел поставить значение раньше
    throw new Error(error.message);
  }
  return data as TaskValue;
}

export async function deleteValueChecked(existing: TaskValue): Promise<void> {
  const rows = await run<unknown[]>(
    supabase
      .from('task_values')
      .delete()
      .eq('task_id', existing.task_id)
      .eq('property_id', existing.property_id)
      .eq('updated_at', existing.updated_at)
      .select('task_id'),
  );
  if (rows.length === 0) throw new ValueConflictError();
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

/**
 * Снимок описания для поиска и экспорта. Идёт отдельно от сохранения названия:
 * описание теперь общее (CRDT), и его правка не должна считаться конфликтом карточки.
 */
export async function saveDescription(id: string, html: string): Promise<void> {
  await run<unknown[]>(
    supabase.from('tasks').update({ description_html: html }).eq('id', id).select('id'),
  );
}

// ---------------------------------------------------------------- состояние совместного текста (Yjs)

type DocTable = 'task_docs' | 'article_docs';
type DocKey = 'task_id' | 'article_id';

/** Сохранённое состояние CRDT в base64; null — документ ещё ни разу не открывали. */
async function getDocState(table: DocTable, key: DocKey, id: string): Promise<string | null> {
  const rows = await run<{ state: string }[]>(
    supabase.from(table).select('state').eq(key, id),
  );
  return rows.length > 0 ? rows[0].state : null;
}

/**
 * Кладёт первый снимок, только если документа ещё нет, и возвращает победивший.
 * Два человека, открывшие карточку или статью одновременно, получат одно и то же
 * состояние: проигравший не создаёт вторую историю правок, а берёт готовую.
 */
async function createDocState(table: DocTable, key: DocKey, id: string, state: string): Promise<string> {
  const inserted = await run<{ state: string }[]>(
    supabase
      .from(table)
      .upsert({ [key]: id, state }, { onConflict: key, ignoreDuplicates: true })
      .select('state'),
  );
  if (inserted.length > 0) return inserted[0].state;
  const current = await getDocState(table, key, id);
  if (!current) throw new Error('Не удалось создать совместный документ.');
  return current;
}

/** Перезаписывает снимок состояния. Правки уже сведены на клиенте, поэтому проверка версии не нужна. */
async function saveDocState(table: DocTable, key: DocKey, id: string, state: string): Promise<void> {
  await run<unknown[]>(
    supabase
      .from(table)
      .upsert({ [key]: id, state }, { onConflict: key })
      .select(key),
  );
}

export const getTaskDocState = (taskId: string) => getDocState('task_docs', 'task_id', taskId);
export const createTaskDocState = (taskId: string, state: string) =>
  createDocState('task_docs', 'task_id', taskId, state);
export const saveTaskDocState = (taskId: string, state: string) =>
  saveDocState('task_docs', 'task_id', taskId, state);

export const getArticleDocState = (articleId: string) => getDocState('article_docs', 'article_id', articleId);
export const createArticleDocState = (articleId: string, state: string) =>
  createDocState('article_docs', 'article_id', articleId, state);
export const saveArticleDocState = (articleId: string, state: string) =>
  saveDocState('article_docs', 'article_id', articleId, state);

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

// ---------------------------------------------------------------- экспорт

const EXPORT_TASK_FIELDS = 'id, column_id, number, title, description_html, position, archived_at, deleted_at';

/**
 * Свежие данные доски для файла: берутся прямо из базы в момент экспорта, а не из состояния экрана.
 * Архивные и удалённые карточки попадают только если их явно запросили.
 */
export async function getExportData(
  boardId: string,
  opts: { includeArchived: boolean; includeDeleted: boolean },
): Promise<{ tasks: ExportTask[]; columns: Column[]; properties: Property[]; options: PropertyOption[]; values: TaskValue[] }> {
  const [tasks, columns, properties, values] = await Promise.all([
    fetchAll<ExportTask>((from, to) => {
      let q = supabase.from('tasks').select(EXPORT_TASK_FIELDS).eq('board_id', boardId);
      if (!opts.includeArchived) q = q.is('archived_at', null);
      if (!opts.includeDeleted) q = q.is('deleted_at', null);
      return q.order('position').order('id').range(from, to);
    }),
    run<Column[]>(supabase.from('board_columns').select(COLUMN_FIELDS).eq('board_id', boardId).order('position')),
    run<Property[]>(supabase.from('properties').select(PROPERTY_FIELDS).eq('board_id', boardId).order('position')),
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
    tasks,
    columns,
    properties,
    options,
    values: values.map((v) => ({
      task_id: v.task_id,
      property_id: v.property_id,
      value_text: v.value_text,
      value_date: v.value_date,
      option_id: v.option_id,
      option_ids: v.option_ids ?? [],
      updated_at: v.updated_at,
    })),
  };
}

// ---------------------------------------------------------------- архив и корзина

const KB_FIELDS = 'id, name, position, archived_at';
const ARTICLE_LIST_FIELDS = 'id, base_id, title, labels, version, updated_at, deleted_at, search_text';
const ARTICLE_FULL_FIELDS = 'id, title, labels, content_html, version';
const ARCHIVE_TASK_FIELDS = 'id, board_id, column_id, number, title, archived_at, deleted_at';

/** Всё, что показывает раздел «Архив и корзина». Читается свежо из базы. */
export async function getArchiveData(): Promise<ArchiveData> {
  const [boards, columns, archivedTasks, trashTasks, knowledgeBases, trashArticles] = await Promise.all([
    run<Board[]>(supabase.from('boards').select(BOARD_FIELDS).order('position')),
    fetchAll<Column>((from, to) => supabase.from('board_columns').select(COLUMN_FIELDS).order('id').range(from, to)),
    fetchAll<ArchiveTask>((from, to) =>
      supabase
        .from('tasks')
        .select(ARCHIVE_TASK_FIELDS)
        .not('archived_at', 'is', null)
        .is('deleted_at', null)
        .order('id')
        .range(from, to),
    ),
    fetchAll<ArchiveTask>((from, to) =>
      supabase.from('tasks').select(ARCHIVE_TASK_FIELDS).not('deleted_at', 'is', null).order('id').range(from, to),
    ),
    run<KnowledgeBase[]>(supabase.from('knowledge_bases').select(KB_FIELDS).order('position')),
    fetchAll<KnowledgeArticle>((from, to) =>
      supabase
        .from('knowledge_articles')
        .select(ARTICLE_LIST_FIELDS)
        .not('deleted_at', 'is', null)
        .order('id')
        .range(from, to),
    ),
  ]);
  return { boards, columns, archivedTasks, trashTasks, knowledgeBases, trashArticles };
}

export async function setBoardArchived(id: string, archived: boolean): Promise<void> {
  await updateBoard(id, { archived_at: archived ? new Date().toISOString() : null });
}

/** Сколько колонок и карточек (всех, включая архивные и корзину) внутри доски: для предупреждения перед удалением. */
export async function countBoardContents(boardId: string): Promise<{ columns: number; tasks: number }> {
  const [c, t] = await Promise.all([
    supabase.from('board_columns').select('id', { count: 'exact', head: true }).eq('board_id', boardId),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('board_id', boardId),
  ]);
  if (c.error) throw new Error(c.error.message);
  if (t.error) throw new Error(t.error.message);
  return { columns: c.count ?? 0, tasks: t.count ?? 0 };
}

/** Окончательное удаление доски: база разрешает только для архивной. Вместе с доской удаляется всё её содержимое. */
export async function deleteBoardForever(id: string): Promise<void> {
  const rows = await run<unknown[]>(supabase.from('boards').delete().eq('id', id).select('id'));
  if (rows.length === 0) throw new Error('Доска не удалена: она должна быть в архиве.');
}

async function callRpc(name: string, args: Record<string, string>): Promise<void> {
  const { error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
}

export const archiveColumn = (id: string) => callRpc('archive_column', { p_column_id: id });
export const restoreColumn = (id: string) => callRpc('restore_column', { p_column_id: id });
export const restoreTask = (id: string) => callRpc('restore_task', { p_task_id: id });
export const restoreTaskFromTrash = (id: string) => callRpc('restore_task_from_trash', { p_task_id: id });

export async function archiveTask(id: string): Promise<void> {
  const rows = await run<unknown[]>(
    supabase.from('tasks').update({ archived_at: new Date().toISOString() }).eq('id', id).select('id'),
  );
  if (rows.length === 0) throw new Error('Карточка не найдена.');
}

/** Мягкое удаление: карточка уходит в корзину и может быть восстановлена. */
export async function trashTask(id: string): Promise<void> {
  const rows = await run<unknown[]>(
    supabase.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id'),
  );
  if (rows.length === 0) throw new Error('Карточка не найдена.');
}

/** Окончательное удаление: база разрешает только карточки из корзины. */
export async function deleteTaskForever(id: string): Promise<void> {
  const rows = await run<unknown[]>(supabase.from('tasks').delete().eq('id', id).select('id'));
  if (rows.length === 0) throw new Error('Карточка не удалена: она должна быть в корзине.');
}

/** Очистка корзины: удаляет насовсем только то, что уже в корзине. Возвращает число удалённых. */
export async function emptyTrash(): Promise<number> {
  const rows = await run<unknown[]>(supabase.from('tasks').delete().not('deleted_at', 'is', null).select('id'));
  return rows.length;
}

// ---------------------------------------------------------------- базы знаний и статьи

export function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  return run<KnowledgeBase[]>(supabase.from('knowledge_bases').select(KB_FIELDS).is('archived_at', null).order('position'));
}

export function createKnowledgeBase(input: { name: string; position: string }): Promise<KnowledgeBase> {
  return run<KnowledgeBase>(supabase.from('knowledge_bases').insert(input).select(KB_FIELDS).single());
}

export function updateKnowledgeBase(id: string, patch: { name?: string; archived_at?: string | null }): Promise<KnowledgeBase> {
  return run<KnowledgeBase>(supabase.from('knowledge_bases').update(patch).eq('id', id).select(KB_FIELDS).single());
}

/** Окончательное удаление базы знаний: база разрешает только архивную. Статьи удаляются вместе с ней. */
export async function deleteKnowledgeBaseForever(id: string): Promise<void> {
  const rows = await run<unknown[]>(supabase.from('knowledge_bases').delete().eq('id', id).select('id'));
  if (rows.length === 0) throw new Error('База знаний не удалена: она должна быть в архиве.');
}

export async function countBaseArticles(baseId: string): Promise<number> {
  const { count, error } = await supabase
    .from('knowledge_articles')
    .select('id', { count: 'exact', head: true })
    .eq('base_id', baseId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Все статьи базы (без удалённых). Текст для поиска приходит сразу, поиск идёт на странице. */
export function listArticles(baseId: string): Promise<KnowledgeArticle[]> {
  return fetchAll<KnowledgeArticle>((from, to) =>
    supabase
      .from('knowledge_articles')
      .select(ARTICLE_LIST_FIELDS)
      .eq('base_id', baseId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .order('id')
      .range(from, to),
  );
}

export function createArticle(input: { base_id: string; title: string }): Promise<KnowledgeArticle> {
  return run<KnowledgeArticle>(supabase.from('knowledge_articles').insert(input).select(ARTICLE_LIST_FIELDS).single());
}

export async function getArticleFull(id: string): Promise<ArticleFull | null> {
  const rows = await run<ArticleFull[]>(
    supabase.from('knowledge_articles').select(ARTICLE_FULL_FIELDS).eq('id', id).is('deleted_at', null),
  );
  return rows.length > 0 ? rows[0] : null;
}

/** Сохранение статьи «если версия не изменилась»; иначе ConflictError. */
export async function saveArticle(
  id: string,
  patch: { title?: string; labels?: string[]; content_html?: string },
  expectedVersion: number,
): Promise<KnowledgeArticle> {
  const rows = await run<KnowledgeArticle[]>(
    supabase
      .from('knowledge_articles')
      .update(patch)
      .eq('id', id)
      .eq('version', expectedVersion)
      .select(ARTICLE_LIST_FIELDS),
  );
  if (rows.length === 0) throw new ConflictError('Статью уже изменил кто-то другой или она удалена.');
  return rows[0];
}

/**
 * Снимок текста статьи для поиска и списка. Идёт отдельно от заголовка и меток:
 * текст общий (CRDT), и его правка не должна считаться конфликтом статьи.
 */
export async function saveArticleContent(id: string, html: string): Promise<KnowledgeArticle> {
  const rows = await run<KnowledgeArticle[]>(
    supabase
      .from('knowledge_articles')
      .update({ content_html: html })
      .eq('id', id)
      .select(ARTICLE_LIST_FIELDS),
  );
  if (rows.length === 0) throw new Error('Статья не найдена.');
  return rows[0];
}

export async function setArticleDeleted(id: string, deleted: boolean): Promise<void> {
  const rows = await run<unknown[]>(
    supabase
      .from('knowledge_articles')
      .update({ deleted_at: deleted ? new Date().toISOString() : null })
      .eq('id', id)
      .select('id'),
  );
  if (rows.length === 0) throw new Error('Статья не найдена.');
}

export async function deleteArticleForever(id: string): Promise<void> {
  const rows = await run<unknown[]>(supabase.from('knowledge_articles').delete().eq('id', id).select('id'));
  if (rows.length === 0) throw new Error('Статья не удалена: она должна быть в корзине.');
}

// ---------------------------------------------------------------- счётчики для статистики

/** Сколько карточек доски в архиве и в корзине (активные считаются по уже загруженным данным). */
export async function getBoardCounts(boardId: string): Promise<{ archived: number; trashed: number }> {
  const [a, d] = await Promise.all([
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('board_id', boardId)
      .not('archived_at', 'is', null)
      .is('deleted_at', null),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('board_id', boardId).not('deleted_at', 'is', null),
  ]);
  if (a.error) throw new Error(a.error.message);
  if (d.error) throw new Error(d.error.message);
  return { archived: a.count ?? 0, trashed: d.count ?? 0 };
}

// ---------------------------------------------------------------- окончательное удаление колонок и свойств

/** Удаляет архивную колонку вместе со всеми её карточками. Возвращает число удалённых карточек. */
export async function deleteColumnForever(id: string): Promise<number> {
  const { data, error } = await supabase.rpc('delete_column_forever', { p_column_id: id });
  if (error) throw new Error(error.message);
  return typeof data === 'number' ? data : 0;
}

/** Сколько карточек в колонке (всех: активных, архивных, из корзины): для предупреждения перед удалением. */
export async function countColumnTasks(columnId: string): Promise<number> {
  const { count, error } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('column_id', columnId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Удаляет архивное свойство; его значения и варианты уходят вместе с ним. База разрешает только архивные. */
export async function deletePropertyForever(id: string): Promise<void> {
  const rows = await run<unknown[]>(supabase.from('properties').delete().eq('id', id).select('id'));
  if (rows.length === 0) throw new Error('Свойство не удалено: оно должно быть в архиве.');
}
