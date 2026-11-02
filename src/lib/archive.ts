import type { Board, Column, KnowledgeArticle, KnowledgeBase } from './types';

/** Карточка в архиве или корзине (без описания). */
export interface ArchiveTask {
  id: string;
  board_id: string;
  column_id: string;
  number: number;
  title: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export interface ArchiveData {
  boards: Board[]; // все доски, включая архивные
  columns: Column[]; // все колонки, включая архивные
  archivedTasks: ArchiveTask[]; // в архиве, не в корзине
  trashTasks: ArchiveTask[]; // в корзине
  knowledgeBases: KnowledgeBase[]; // все базы знаний, включая архивные
  trashArticles: KnowledgeArticle[]; // удалённые статьи
}

/** Строка раздела «Архив и корзина». */
export interface ArchiveRow {
  id: string;
  boardId: string;
  title: string;
  subtitle: string;
  when: string | null; // когда попала в архив или корзину (ISO)
  note?: string; // что произойдёт при восстановлении
  kind?: 'base' | 'article'; // для вкладки «Знания»: что это за строка
}

const byWhenDesc = (a: ArchiveRow, b: ArchiveRow) => {
  const x = a.when ?? '';
  const y = b.when ?? '';
  return x < y ? 1 : x > y ? -1 : 0;
};

export function boardRows(data: ArchiveData): ArchiveRow[] {
  return data.boards
    .filter((b) => b.archived_at !== null)
    .map((b) => ({ id: b.id, boardId: b.id, title: b.name, subtitle: b.description ?? '', when: b.archived_at }))
    .sort(byWhenDesc);
}

export function columnRows(data: ArchiveData): ArchiveRow[] {
  const boardName = new Map(data.boards.map((b) => [b.id, b.name] as const));
  return data.columns
    .filter((c) => c.archived_at !== null)
    .map((c) => {
      const inBoardArchived = data.boards.find((b) => b.id === c.board_id)?.archived_at != null;
      return {
        id: c.id,
        boardId: c.board_id,
        title: c.name,
        subtitle: `Доска: ${boardName.get(c.board_id) ?? '—'}`,
        when: c.archived_at,
        note: inBoardArchived ? 'Доска тоже в архиве: колонка вернётся, когда вернёшь доску.' : undefined,
      };
    })
    .sort(byWhenDesc);
}

function taskRowsOf(tasks: ArchiveTask[], data: ArchiveData, whenOf: (t: ArchiveTask) => string | null, trash: boolean): ArchiveRow[] {
  const boardName = new Map(data.boards.map((b) => [b.id, b.name] as const));
  const columnById = new Map(data.columns.map((c) => [c.id, c] as const));
  return tasks
    .map((t) => {
      const column = columnById.get(t.column_id);
      const columnArchived = column?.archived_at != null;
      const boardArchived = data.boards.find((b) => b.id === t.board_id)?.archived_at != null;
      const notes: string[] = [];
      if (columnArchived) {
        notes.push(
          trash
            ? `Колонка «${column?.name}» в архиве: карточка вернётся в архив.`
            : `Колонка «${column?.name}» в архиве: она вернётся вместе с карточкой.`,
        );
      }
      if (boardArchived) notes.push('Доска тоже в архиве: на доске карточка появится, когда вернёшь доску.');
      const note = notes.length > 0 ? notes.join(' ') : undefined;
      return {
        id: t.id,
        boardId: t.board_id,
        title: `#${t.number} ${t.title}`,
        subtitle: `${boardName.get(t.board_id) ?? '—'} · ${column?.name ?? '—'}`,
        when: whenOf(t),
        note,
      };
    })
    .sort(byWhenDesc);
}

export const archivedTaskRows = (data: ArchiveData): ArchiveRow[] =>
  taskRowsOf(data.archivedTasks, data, (t) => t.archived_at, false);

export const trashRows = (data: ArchiveData): ArchiveRow[] =>
  taskRowsOf(data.trashTasks, data, (t) => t.deleted_at, true);

/** Поиск по названию и подписи без учёта регистра; boardId ограничивает доской (null: все). */
export function filterRows(rows: ArchiveRow[], query: string, boardId: string | null): ArchiveRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (boardId === null || r.boardId === boardId) &&
      (q === '' || r.title.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q)),
  );
}

/** Вкладка «Знания»: архивные базы знаний и удалённые статьи. */
export function knowledgeRows(data: ArchiveData): ArchiveRow[] {
  const baseName = new Map(data.knowledgeBases.map((b) => [b.id, b.name] as const));
  const bases: ArchiveRow[] = data.knowledgeBases
    .filter((b) => b.archived_at !== null)
    .map((b) => ({
      id: b.id,
      boardId: b.id,
      title: b.name,
      subtitle: 'База знаний',
      when: b.archived_at,
      kind: 'base' as const,
    }));
  const articles: ArchiveRow[] = data.trashArticles.map((a) => {
    const base = data.knowledgeBases.find((b) => b.id === a.base_id);
    return {
      id: a.id,
      boardId: a.base_id,
      title: a.title,
      subtitle: `Статья · ${baseName.get(a.base_id) ?? '—'}`,
      when: a.deleted_at,
      note: base?.archived_at != null ? 'База знаний тоже в архиве: статья появится, когда вернёшь базу.' : undefined,
      kind: 'article' as const,
    };
  });
  return [...bases, ...articles].sort(byWhenDesc);
}
