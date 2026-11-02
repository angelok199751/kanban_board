import { archivedTaskRows, boardRows, columnRows, filterRows, knowledgeRows, trashRows, type ArchiveData, type ArchiveTask } from '../../../src/lib/archive';

const eq = (a: unknown, b: unknown, m: string) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`); };

const board = (id: string, name: string, archived_at: string | null) => ({ id, name, description: null, position: 'a0', archived_at });
const col = (id: string, board_id: string, name: string, archived_at: string | null) => ({ id, board_id, name, color: 'gray' as const, position: 'a0', archived_at });
const task = (id: string, board_id: string, column_id: string, number: number, title: string, archived_at: string | null, deleted_at: string | null): ArchiveTask =>
  ({ id, board_id, column_id, number, title, archived_at, deleted_at });

const data: ArchiveData = {
  boards: [board('b1', 'Релиз', null), board('b2', 'Старая', '2026-02-01T10:00:00Z')],
  columns: [col('c1', 'b1', 'Новые', null), col('c2', 'b1', 'Готово', '2026-03-01T10:00:00Z'), col('c3', 'b2', 'Всё', '2026-02-01T10:00:00Z')],
  archivedTasks: [
    task('t1', 'b1', 'c1', 1, 'Старая карточка', '2026-01-05T10:00:00Z', null),
    task('t2', 'b1', 'c2', 2, 'Ушла с колонкой', '2026-03-01T10:00:00Z', null),
  ],
  knowledgeBases: [{ id: 'k1', name: 'Инструкции', position: 'a0', archived_at: null }, { id: 'k2', name: 'Старая база', position: 'a1', archived_at: '2026-02-05T10:00:00Z' }],
  trashArticles: [
    { id: 'a1', base_id: 'k1', title: 'Удалённая статья', labels: [], version: 1, updated_at: '2026-03-01T00:00:00Z', deleted_at: '2026-03-20T10:00:00Z', search_text: '' },
    { id: 'a2', base_id: 'k2', title: 'Статья в архивной базе', labels: [], version: 1, updated_at: '2026-03-01T00:00:00Z', deleted_at: '2026-03-21T10:00:00Z', search_text: '' },
  ],
  trashTasks: [task('t5', 'b2', 'c3', 5, 'На архивной доске', null, '2026-03-13T10:00:00Z'), task('t3', 'b1', 'c2', 3, 'Удалённая', null, '2026-03-10T10:00:00Z'), task('t4', 'b1', 'c1', 4, 'Мусор', null, '2026-03-12T10:00:00Z')],
};

eq(boardRows(data).map((r) => r.title), ['Старая'], 'archived boards only');
eq(columnRows(data).map((r) => r.title), ['Готово', 'Всё'], 'archived columns, newest first');
eq(columnRows(data)[1].note !== undefined, true, 'column in archived board has a note');
eq(columnRows(data)[0].note, undefined, 'column in live board has no note');

const tasks = archivedTaskRows(data);
eq(tasks.map((r) => r.id), ['t2', 't1'], 'archived tasks newest first');
eq(tasks[0].subtitle, 'Релиз · Готово', 'subtitle');
eq(tasks[0].note, 'Колонка «Готово» в архиве: она вернётся вместе с карточкой.', 'note: column returns with task');
eq(tasks[1].note, undefined, 'no note when column is live');

const trash = trashRows(data);
eq(trash.map((r) => r.id), ['t5', 't4', 't3'], 'trash newest first');
eq(trash[0].note, 'Колонка «Всё» в архиве: карточка вернётся в архив. Доска тоже в архиве: на доске карточка появится, когда вернёшь доску.', 'note: archived column and archived board');
eq(trash[2].note, 'Колонка «Готово» в архиве: карточка вернётся в архив.', 'note: trash into archived column goes to archive');

eq(filterRows(tasks, 'ушла', null).map((r) => r.id), ['t2'], 'search title');
eq(filterRows(tasks, 'ГОТОВО', null).map((r) => r.id), ['t2'], 'search subtitle, case-insensitive');
eq(filterRows(tasks, '', 'b2').length, 0, 'board filter');
eq(filterRows(tasks, '  ', 'b1').length, 2, 'blank query keeps all');
const kn = knowledgeRows(data);
eq(kn.map((r) => r.id), ['a2', 'a1', 'k2'], 'knowledge rows newest first (bases + deleted articles)');
eq(kn.find((r) => r.id === 'k2')?.kind, 'base', 'archived base row');
eq(kn.find((r) => r.id === 'a1')?.kind, 'article', 'deleted article row');
eq(kn.find((r) => r.id === 'a1')?.note, undefined, 'article in live base has no note');
eq(kn.find((r) => r.id === 'a2')?.note, 'База знаний тоже в архиве: статья появится, когда вернёшь базу.', 'article in archived base has a note');
console.log('archive tests ok');
