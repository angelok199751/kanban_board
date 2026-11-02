import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { humanizeError } from '../../lib/supabase';
import { useNotice } from '../../lib/notice';
import { compareByPosition, keyBetween, planMove } from '../../lib/positions';
import type { Board, BoardData, ColorName, KnowledgeArticle, KnowledgeBase, Property, PropertyType, SavedView, Task, TaskValue } from '../../lib/types';
import { selectedOptionIds } from '../../lib/values';
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

export function useArchive() {
  return useQuery({ queryKey: ['archive'] as const, queryFn: api.getArchiveData });
}

export function useKnowledgeBases() {
  return useQuery({ queryKey: ['kb-bases'] as const, queryFn: api.listKnowledgeBases });
}

export function useArticles(baseId: string) {
  return useQuery({ queryKey: ['kb-articles', baseId] as const, queryFn: () => api.listArticles(baseId) });
}

export const viewsKey = (boardId: string) => ['views', boardId] as const;

export function useViews(boardId: string) {
  return useQuery({ queryKey: viewsKey(boardId), queryFn: () => api.listViews(boardId) });
}

/** Id карточек, подходящих под строку поиска (название и описание). Пока идёт новый поиск, показываем прежний результат. */
export function useSearchIds(boardId: string, query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['search', boardId, q] as const,
    queryFn: () => api.searchTaskIds(boardId, q),
    enabled: q !== '',
    placeholderData: keepPreviousData,
    staleTime: 5000,
  });
}

function messageOf(e: unknown): string {
  return humanizeError(e instanceof Error ? e.message : String(e));
}

const lastPosition = (items: { position: string; id: string }[]): string | null => {
  const sorted = [...items].sort(compareByPosition);
  return sorted.length > 0 ? sorted[sorted.length - 1].position : null;
};

/**
 * Действия над досками, колонками, карточками и свойствами.
 * Методы создания и изменения бросают ошибку (её показывает диалог).
 * Методы переноса (moveColumn, moveTask, moveProperty) применяют перенос сразу,
 * а при ошибке откатывают его и показывают уведомление.
 */
export function useActions() {
  const qc = useQueryClient();
  const { notify } = useNotice();

  const boardCache = (boardId: string) => qc.getQueryData<BoardData>(qk.board(boardId));
  const refresh = (boardId: string) => qc.invalidateQueries({ queryKey: qk.board(boardId) });
  const patchCache = (boardId: string, fn: (d: BoardData) => BoardData) => {
    const d = boardCache(boardId);
    if (d) qc.setQueryData<BoardData>(qk.board(boardId), fn(d));
  };

  // ------------------------------------------------------------ доски
  async function createBoard(name: string, description: string) {
    const boards = qc.getQueryData<{ position: string; id: string }[]>(qk.boards) ?? [];
    const created = await api.createBoard({
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      position: keyBetween(lastPosition(boards), null),
    });
    // сразу кладём новую доску в список: иначе при переходе на неё адрес может обогнать обновление списка
    qc.setQueryData<Board[]>(qk.boards, (old) => [...(old ?? []), created]);
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
    await api.createColumn({
      board_id: boardId,
      name: name.trim(),
      color,
      position: keyBetween(lastPosition(boardCache(boardId)?.columns ?? []), null),
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
    const plan = planMove(new Map(before.columns.map((c) => [c.id, c.position] as const)), orderedIds, columnId);
    if (!plan) return;
    const posById = new Map(plan.map((u) => [u.id, u.position] as const));

    patchCache(boardId, (d) => ({
      ...d,
      columns: d.columns.map((c) => {
        const p = posById.get(c.id);
        return p === undefined ? c : { ...c, position: p };
      }),
    }));
    try {
      await Promise.all(plan.map((u) => api.updateColumn(u.id, { position: u.position })));
    } catch (e) {
      qc.setQueryData<BoardData>(qk.board(boardId), before);
      notify(`Не удалось переставить колонку: ${messageOf(e)}`);
    } finally {
      void refresh(boardId);
    }
  }

  // ------------------------------------------------------------ карточки
  async function createTask(boardId: string, columnId: string, title: string) {
    const inColumn = (boardCache(boardId)?.tasks ?? []).filter((t) => t.column_id === columnId);
    await api.createTask({
      board_id: boardId,
      column_id: columnId,
      title: title.trim(),
      position: keyBetween(lastPosition(inColumn), null),
    });
    await refresh(boardId);
  }

  /**
   * Сохраняет название и/или описание карточки с проверкой версии: чужие изменения молча не затираем
   * (при расхождении бросает ConflictError). Список доски обновляется без полной перезагрузки.
   */
  async function saveTask(
    boardId: string,
    taskId: string,
    patch: { title?: string; description_html?: string },
    expectedVersion: number,
  ): Promise<Task> {
    const saved = await api.saveTask(taskId, patch, expectedVersion);
    patchCache(boardId, (d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === taskId ? { ...t, title: saved.title, version: saved.version } : t)),
    }));
    if (patch.description_html !== undefined) void qc.invalidateQueries({ queryKey: ['search', boardId] });
    return saved;
  }

  /** orderedIds: карточки целевой колонки в новом порядке (включая переносимую). */
  async function moveTask(boardId: string, taskId: string, columnId: string, orderedIds: string[]) {
    const before = boardCache(boardId);
    if (!before) return;
    const plan = planMove(new Map(before.tasks.map((t) => [t.id, t.position] as const)), orderedIds, taskId);
    if (!plan) return;
    const updates = plan.map((u) => ({
      id: u.id,
      patch: u.id === taskId ? { column_id: columnId, position: u.position } : { position: u.position },
    }));
    const patchById = new Map(updates.map((u) => [u.id, u.patch] as const));

    patchCache(boardId, (d) => ({
      ...d,
      tasks: d.tasks.map((t) => {
        const p = patchById.get(t.id);
        return p === undefined ? t : { ...t, ...p };
      }),
    }));
    try {
      await Promise.all(updates.map((u) => api.updateTask(u.id, u.patch)));
    } catch (e) {
      qc.setQueryData<BoardData>(qk.board(boardId), before);
      notify(`Не удалось переместить карточку: ${messageOf(e)}`);
    } finally {
      void refresh(boardId);
    }
  }

  // ------------------------------------------------------------ свойства
  async function createProperty(boardId: string, name: string, type: PropertyType, multiple = false) {
    await api.createProperty({
      board_id: boardId,
      name: name.trim(),
      type,
      multiple: type === 'select' ? multiple : false,
      position: keyBetween(lastPosition(boardCache(boardId)?.properties ?? []), null),
    });
    await refresh(boardId);
  }

  async function renameProperty(boardId: string, id: string, name: string) {
    try {
      await api.updateProperty(id, { name: name.trim() });
    } finally {
      await refresh(boardId);
    }
  }

  async function setPropertyHidden(boardId: string, id: string, hidden: boolean) {
    try {
      await api.updateProperty(id, { hidden });
    } finally {
      await refresh(boardId);
    }
  }

  /** Список с несколькими значениями: база сама приводит уже сохранённые значения к новому виду. */
  async function setPropertyMultiple(boardId: string, id: string, multiple: boolean) {
    try {
      await api.setPropertyMultiple(id, multiple);
    } finally {
      await refresh(boardId);
    }
  }

  /** «Удаление» свойства: уходит в архив вместе со значениями, вернуть можно. */
  async function setPropertyArchived(boardId: string, id: string, archived: boolean) {
    try {
      await api.updateProperty(id, { archived_at: archived ? new Date().toISOString() : null });
    } finally {
      await refresh(boardId);
    }
  }

  /** Окончательное удаление архивного свойства вместе со значениями и вариантами. */
  async function deletePropertyForever(boardId: string, id: string) {
    try {
      await api.deletePropertyForever(id);
    } finally {
      await refresh(boardId);
    }
  }

  /** orderedIds: все свойства доски в новом порядке. */
  async function moveProperty(boardId: string, propertyId: string, orderedIds: string[]) {
    const before = boardCache(boardId);
    if (!before) return;
    const plan = planMove(new Map(before.properties.map((p) => [p.id, p.position] as const)), orderedIds, propertyId);
    if (!plan) return;
    const posById = new Map(plan.map((u) => [u.id, u.position] as const));

    patchCache(boardId, (d) => ({
      ...d,
      properties: d.properties.map((p) => {
        const pos = posById.get(p.id);
        return pos === undefined ? p : { ...p, position: pos };
      }),
    }));
    try {
      await Promise.all(plan.map((u) => api.updateProperty(u.id, { position: u.position })));
    } catch (e) {
      qc.setQueryData<BoardData>(qk.board(boardId), before);
      notify(`Не удалось переставить свойство: ${messageOf(e)}`);
    } finally {
      void refresh(boardId);
    }
  }

  // ------------------------------------------------------------ варианты списка
  async function createOption(boardId: string, propertyId: string, label: string, color: ColorName) {
    const options = (boardCache(boardId)?.options ?? []).filter((o) => o.property_id === propertyId);
    try {
      await api.createOption({
        property_id: propertyId,
        label: label.trim(),
        color,
        position: keyBetween(lastPosition(options), null),
      });
    } finally {
      await refresh(boardId);
    }
  }

  async function updateOption(boardId: string, id: string, patch: { label?: string; color?: ColorName }) {
    try {
      await api.updateOption(id, { ...patch, label: patch.label === undefined ? undefined : patch.label.trim() });
    } finally {
      await refresh(boardId);
    }
  }

  /** Сколько карточек (включая архивные и из корзины) используют вариант. */
  function optionUsage(boardId: string, optionId: string): number {
    return (boardCache(boardId)?.values ?? []).filter((v) => selectedOptionIds(v).includes(optionId)).length;
  }

  /** Удаляет вариант. Если он выбран в карточках, сначала очищает эти значения: интерфейс спрашивает подтверждение заранее. */
  async function deleteOption(boardId: string, optionId: string) {
    try {
      if (optionUsage(boardId, optionId) > 0) await api.clearOptionValues(optionId);
      await api.deleteOption(optionId);
    } finally {
      await refresh(boardId);
    }
  }

  // ------------------------------------------------------------ значения свойств
  /**
   * Сохраняет значение свойства у карточки. raw: для одиночного списка id варианта,
   * для списка с несколькими значениями массив id, для остальных текст или 'YYYY-MM-DD'.
   * Пустое значение удаляет запись.
   * По умолчанию сохраняем только если значение не менялось с тех пор, как мы его видели; иначе ValueConflictError
   * (и данные доски обновляются, чтобы человек увидел, что там сейчас). force: записать поверх.
   */
  async function setTaskValue(
    boardId: string,
    taskId: string,
    property: Property,
    raw: string | string[] | null,
    force = false,
  ) {
    const multi = property.type === 'select' && property.multiple;
    const optionIds = multi ? (Array.isArray(raw) ? raw : raw === null ? [] : [raw]) : [];
    const value = multi || Array.isArray(raw) ? '' : (raw === null ? '' : raw.trim());
    const same = (v: TaskValue) => v.task_id === taskId && v.property_id === property.id;
    const existing = boardCache(boardId)?.values.find(same);

    try {
      if (multi ? optionIds.length === 0 : value === '') {
        if (!existing && !force) return;
        if (force || !existing) await api.deleteValue(taskId, property.id);
        else await api.deleteValueChecked(existing);
        patchCache(boardId, (d) => ({ ...d, values: d.values.filter((v) => !same(v)) }));
        return;
      }
      const next: api.NewValue = {
        task_id: taskId,
        property_id: property.id,
        value_text: property.type === 'text' || property.type === 'url' ? value : null,
        value_date: property.type === 'date' ? value : null,
        option_id: property.type === 'select' && !multi ? value : null,
        option_ids: multi ? [...new Set(optionIds)] : [],
      };
      const saved = force ? await api.upsertValue(next) : await api.saveValueChecked(existing, next);
      patchCache(boardId, (d) => ({ ...d, values: [...d.values.filter((v) => !same(v)), saved] }));
    } catch (e) {
      if (e instanceof api.ValueConflictError) void refresh(boardId);
      throw e;
    }
  }

  // ------------------------------------------------------------ архив и корзина
  /** После любой операции с архивом обновляем всё, что могло измениться: доски, содержимое, поиск, сам архив. */
  async function refreshEverywhere() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.boards }),
      qc.invalidateQueries({ queryKey: ['board'] }),
      qc.invalidateQueries({ queryKey: ['archive'] }),
      qc.invalidateQueries({ queryKey: ['search'] }),
      qc.invalidateQueries({ queryKey: ['kb-bases'] }),
      qc.invalidateQueries({ queryKey: ['kb-articles'] }),
    ]);
  }

  /** Обёртка: выполняет операцию и обновляет данные даже при ошибке (чтобы экран не расходился с базой). */
  async function archiveOp(work: () => Promise<unknown>) {
    try {
      await work();
    } finally {
      await refreshEverywhere();
    }
  }

  const setBoardArchived = (id: string, archived: boolean) => archiveOp(() => api.setBoardArchived(id, archived));
  const deleteBoardForever = (id: string) => archiveOp(() => api.deleteBoardForever(id));
  const archiveColumn = (id: string) => archiveOp(() => api.archiveColumn(id));
  /** Окончательное удаление архивной колонки вместе с карточками. Возвращает число удалённых карточек. */
  const deleteColumnForever = async (id: string): Promise<number> => {
    try {
      return await api.deleteColumnForever(id);
    } finally {
      await refreshEverywhere();
    }
  };
  const restoreColumn = (id: string) => archiveOp(() => api.restoreColumn(id));
  const archiveTask = (id: string) => archiveOp(() => api.archiveTask(id));
  const trashTask = (id: string) => archiveOp(() => api.trashTask(id));
  const restoreTask = (id: string) => archiveOp(() => api.restoreTask(id));
  const restoreTaskFromTrash = (id: string) => archiveOp(() => api.restoreTaskFromTrash(id));
  const deleteTaskForever = (id: string) => archiveOp(() => api.deleteTaskForever(id));
  const emptyTrash = async (): Promise<number> => {
    try {
      return await api.emptyTrash();
    } finally {
      await refreshEverywhere();
    }
  };

  // ------------------------------------------------------------ базы знаний
  async function createKnowledgeBase(name: string) {
    const bases = qc.getQueryData<KnowledgeBase[]>(['kb-bases']) ?? [];
    const created = await api.createKnowledgeBase({ name: name.trim(), position: keyBetween(lastPosition(bases), null) });
    qc.setQueryData<KnowledgeBase[]>(['kb-bases'], (old) => [...(old ?? []), created]);
    await qc.invalidateQueries({ queryKey: ['kb-bases'] });
    return created;
  }

  async function renameKnowledgeBase(id: string, name: string) {
    await api.updateKnowledgeBase(id, { name: name.trim() });
    await qc.invalidateQueries({ queryKey: ['kb-bases'] });
  }

  const setKnowledgeBaseArchived = (id: string, archived: boolean) =>
    archiveOp(() => api.updateKnowledgeBase(id, { archived_at: archived ? new Date().toISOString() : null }));
  const deleteKnowledgeBaseForever = (id: string) => archiveOp(() => api.deleteKnowledgeBaseForever(id));

  async function createArticle(baseId: string, title: string): Promise<KnowledgeArticle> {
    const created = await api.createArticle({ base_id: baseId, title: title.trim() });
    await qc.invalidateQueries({ queryKey: ['kb-articles', baseId] });
    return created;
  }

  /** Сохранение статьи с проверкой версии (ConflictError при расхождении). Список статей обновляется без перезагрузки. */
  async function saveArticle(
    baseId: string,
    id: string,
    patch: { title?: string; labels?: string[]; content_html?: string },
    expectedVersion: number,
  ): Promise<KnowledgeArticle> {
    const saved = await api.saveArticle(id, patch, expectedVersion);
    const key = ['kb-articles', baseId] as const;
    const list = qc.getQueryData<KnowledgeArticle[]>(key);
    if (list) qc.setQueryData<KnowledgeArticle[]>(key, list.map((a) => (a.id === id ? saved : a)));
    return saved;
  }

  const trashArticle = (id: string) => archiveOp(() => api.setArticleDeleted(id, true));
  const restoreArticle = (id: string) => archiveOp(() => api.setArticleDeleted(id, false));
  const deleteArticleForever = (id: string) => archiveOp(() => api.deleteArticleForever(id));

  // ------------------------------------------------------------ представления
  async function createView(boardId: string, ownerId: string | null, name: string, config: unknown) {
    const views = qc.getQueryData<SavedView[]>(viewsKey(boardId)) ?? [];
    const created = await api.createView({
      board_id: boardId,
      owner_id: ownerId,
      name: name.trim(),
      config,
      position: keyBetween(lastPosition(views), null),
    });
    await qc.invalidateQueries({ queryKey: viewsKey(boardId) });
    return created;
  }

  async function updateView(boardId: string, id: string, patch: { name?: string; config?: unknown }) {
    await api.updateView(id, patch.name === undefined ? patch : { ...patch, name: patch.name.trim() });
    await qc.invalidateQueries({ queryKey: viewsKey(boardId) });
  }

  async function deleteView(boardId: string, id: string) {
    await api.deleteView(id);
    await qc.invalidateQueries({ queryKey: viewsKey(boardId) });
  }

  return {
    createBoard,
    renameBoard,
    createColumn,
    updateColumn,
    moveColumn,
    createTask,
    saveTask,
    moveTask,
    createProperty,
    renameProperty,
    setPropertyHidden,
    setPropertyMultiple,
    setPropertyArchived,
    deletePropertyForever,
    moveProperty,
    createOption,
    updateOption,
    optionUsage,
    deleteOption,
    setTaskValue,
    createView,
    updateView,
    deleteView,
    setBoardArchived,
    deleteBoardForever,
    archiveColumn,
    deleteColumnForever,
    restoreColumn,
    archiveTask,
    trashTask,
    restoreTask,
    restoreTaskFromTrash,
    deleteTaskForever,
    emptyTrash,
    createKnowledgeBase,
    renameKnowledgeBase,
    setKnowledgeBaseArchived,
    deleteKnowledgeBaseForever,
    createArticle,
    saveArticle,
    trashArticle,
    restoreArticle,
    deleteArticleForever,
  };
}
