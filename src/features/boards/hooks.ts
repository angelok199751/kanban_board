import { useQuery, useQueryClient } from '@tanstack/react-query';
import { humanizeError } from '../../lib/supabase';
import { useNotice } from '../../lib/notice';
import { compareByPosition, keyBetween, nKeys } from '../../lib/positions';
import type { BoardData, ColorName, Column, Task } from '../../lib/types';
import * as api from './api';

export const qk = {
  boards: ['boards'] as const,
  board: (id: string) => ['board', id] as const,
};

export function useBoards() {
  return useQuery({ queryKey: qk.boards, queryFn: api.listBoards });
}

export function useBoardData(boardId: string | null) {
  return useQuery({
    queryKey: qk.board(boardId ?? ''),
    queryFn: () => api.getBoardData(boardId as string),
    enabled: boardId !== null,
  });
}

function messageOf(e: unknown): string {
  return humanizeError(e instanceof Error ? e.message : String(e));
}

/**
 * Действия над досками, колонками и карточками.
 * Методы создания и переименования бросают ошибку (её показывает диалог).
 * Методы переноса (moveColumn, moveTask) применяют перенос сразу, а при ошибке откатывают его и показывают уведомление.
 */
export function useActions() {
  const qc = useQueryClient();
  const { notify } = useNotice();

  const boardCache = (boardId: string) => qc.getQueryData<BoardData>(qk.board(boardId));
  const refresh = (boardId: string) => qc.invalidateQueries({ queryKey: qk.board(boardId) });

  // ------------------------------------------------------------ доски
  async function createBoard(name: string, description: string) {
    const boards = qc.getQueryData<{ position: string; id: string }[]>(qk.boards) ?? [];
    const last = [...boards].sort(compareByPosition).pop();
    const created = await api.createBoard({
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      position: keyBetween(last ? last.position : null, null),
    });
    await qc.invalidateQueries({ queryKey: qk.boards });
    return created;
  }

  async function renameBoard(id: string, name: string, description: string) {
    await api.updateBoard(id, {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
    });
    await qc.invalidateQueries({ queryKey: qk.boards });
  }

  // ------------------------------------------------------------ колонки
  async function createColumn(boardId: string, name: string, color: ColorName) {
    const columns = [...(boardCache(boardId)?.columns ?? [])].sort(compareByPosition);
    const last = columns[columns.length - 1];
    await api.createColumn({
      board_id: boardId,
      name: name.trim(),
      color,
      position: keyBetween(last ? last.position : null, null),
    });
    await refresh(boardId);
  }

  async function updateColumn(boardId: string, id: string, name: string, color: ColorName) {
    await api.updateColumn(id, { name: name.trim(), color });
    await refresh(boardId);
  }

  /** orderedIds: все активные колонки доски в новом порядке. */
  async function moveColumn(boardId: string, columnId: string, orderedIds: string[]) {
    const before = boardCache(boardId);
    if (!before) return;
    const byId = new Map<string, Column>(before.columns.map((c) => [c.id, c]));
    const i = orderedIds.indexOf(columnId);
    if (i < 0) return;
    const prevPos = i > 0 ? (byId.get(orderedIds[i - 1])?.position ?? null) : null;
    const nextPos = i < orderedIds.length - 1 ? (byId.get(orderedIds[i + 1])?.position ?? null) : null;

    let updates: { id: string; position: string }[];
    try {
      updates = [{ id: columnId, position: keyBetween(prevPos, nextPos) }];
    } catch {
      // ключи соседей совпали или перепутаны: перенумеруем все колонки
      const keys = nKeys(orderedIds.length);
      updates = orderedIds.map((id, idx) => ({ id, position: keys[idx] }));
    }

    const posById = new Map(updates.map((u) => [u.id, u.position] as const));
    qc.setQueryData<BoardData>(qk.board(boardId), {
      ...before,
      columns: before.columns.map((c) => {
        const p = posById.get(c.id);
        return p === undefined ? c : { ...c, position: p };
      }),
    });
    try {
      await Promise.all(updates.map((u) => api.updateColumn(u.id, { position: u.position })));
    } catch (e) {
      qc.setQueryData<BoardData>(qk.board(boardId), before);
      notify(`Не удалось переставить колонку: ${messageOf(e)}`);
    } finally {
      void refresh(boardId);
    }
  }

  // ------------------------------------------------------------ карточки
  async function createTask(boardId: string, columnId: string, title: string) {
    const inColumn = (boardCache(boardId)?.tasks ?? []).filter((t) => t.column_id === columnId).sort(compareByPosition);
    const last = inColumn[inColumn.length - 1];
    await api.createTask({
      board_id: boardId,
      column_id: columnId,
      title: title.trim(),
      position: keyBetween(last ? last.position : null, null),
    });
    await refresh(boardId);
  }

  /** Сохранение названия с проверкой версии: чужие изменения молча не затираем. */
  async function renameTask(boardId: string, task: Task, title: string) {
    try {
      await api.updateTask(task.id, { title: title.trim() }, task.version);
    } finally {
      await refresh(boardId);
    }
  }

  /** orderedIds: карточки целевой колонки в новом порядке (включая переносимую). */
  async function moveTask(boardId: string, taskId: string, columnId: string, orderedIds: string[]) {
    const before = boardCache(boardId);
    if (!before) return;
    const byId = new Map<string, Task>(before.tasks.map((t) => [t.id, t]));
    const i = orderedIds.indexOf(taskId);
    if (i < 0) return;
    const prevPos = i > 0 ? (byId.get(orderedIds[i - 1])?.position ?? null) : null;
    const nextPos = i < orderedIds.length - 1 ? (byId.get(orderedIds[i + 1])?.position ?? null) : null;

    type Patch = { column_id?: string; position?: string };
    let updates: { id: string; patch: Patch }[];
    try {
      updates = [{ id: taskId, patch: { column_id: columnId, position: keyBetween(prevPos, nextPos) } }];
    } catch {
      // ключи соседей совпали или перепутаны: перенумеруем карточки колонки
      const keys = nKeys(orderedIds.length);
      updates = orderedIds.map((id, idx) => ({
        id,
        patch: id === taskId ? { column_id: columnId, position: keys[idx] } : { position: keys[idx] },
      }));
    }

    const patchById = new Map(updates.map((u) => [u.id, u.patch] as const));
    qc.setQueryData<BoardData>(qk.board(boardId), {
      ...before,
      tasks: before.tasks.map((t) => {
        const p = patchById.get(t.id);
        return p === undefined ? t : { ...t, ...p };
      }),
    });
    try {
      await Promise.all(updates.map((u) => api.updateTask(u.id, u.patch)));
    } catch (e) {
      qc.setQueryData<BoardData>(qk.board(boardId), before);
      notify(`Не удалось переместить карточку: ${messageOf(e)}`);
    } finally {
      void refresh(boardId);
    }
  }

  return { createBoard, renameBoard, createColumn, updateColumn, moveColumn, createTask, renameTask, moveTask };
}
