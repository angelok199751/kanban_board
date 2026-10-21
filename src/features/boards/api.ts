import { supabase } from '../../lib/supabase';
import type { Board, BoardData, Column, ColorName, Task } from '../../lib/types';

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

async function run<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (data === null) throw new Error('Сервер вернул пустой ответ');
  return data as T;
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
  const [columns, tasks] = await Promise.all([
    run<Column[]>(
      supabase
        .from('board_columns')
        .select(COLUMN_FIELDS)
        .eq('board_id', boardId)
        .is('archived_at', null)
        .order('position'),
    ),
    run<Task[]>(
      supabase
        .from('tasks')
        .select(TASK_FIELDS)
        .eq('board_id', boardId)
        .is('archived_at', null)
        .is('deleted_at', null)
        .order('position'),
    ),
  ]);
  return { columns, tasks };
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
