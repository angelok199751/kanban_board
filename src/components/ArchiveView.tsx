import { useEffect, useMemo, useState } from 'react';
import * as api from '../features/boards/api';
import { useActions, useArchive } from '../features/boards/hooks';
import {
  archivedTaskRows,
  boardRows,
  columnRows,
  filterRows,
  knowledgeRows,
  trashRows,
  type ArchiveRow,
} from '../lib/archive';
import { plural } from '../lib/format';
import { useNotice } from '../lib/notice';
import { humanizeError } from '../lib/supabase';
import { DangerConfirmDialog } from './ConfirmDialog';

type Tab = 'boards' | 'columns' | 'tasks' | 'trash' | 'knowledge';

type Pending =
  | { kind: 'board'; row: ArchiveRow }
  | { kind: 'column'; row: ArchiveRow }
  | { kind: 'task'; row: ArchiveRow }
  | { kind: 'base'; row: ArchiveRow }
  | { kind: 'article'; row: ArchiveRow }
  | { kind: 'emptyTrash'; count: number }
  | null;

const TAB_LABELS: Record<Tab, string> = {
  boards: 'Доски',
  columns: 'Колонки',
  tasks: 'Карточки',
  trash: 'Корзина',
  knowledge: 'Знания',
};

const errText = (e: unknown) => humanizeError(e instanceof Error ? e.message : String(e));

const formatWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '';

/** Перед окончательным удалением доски показываем, сколько всего внутри. */
function BoardDeleteDialog({ row, onConfirm, onClose }: { row: ArchiveRow; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [counts, setCounts] = useState<{ columns: number; tasks: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .countBoardContents(row.id)
      .then((c) => !cancelled && setCounts(c))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  return (
    <DangerConfirmDialog
      title="Удалить доску навсегда?"
      confirmLabel="Удалить навсегда"
      phrase={row.title}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      Доска «{row.title}» будет удалена вместе со всем содержимым:{' '}
      {counts
        ? `${counts.columns} ${plural(counts.columns, 'колонка', 'колонки', 'колонок')} и ${counts.tasks} ${plural(counts.tasks, 'карточка', 'карточки', 'карточек')} (включая архивные и из корзины)`
        : failed
          ? 'колонками, карточками и свойствами (посчитать не удалось)'
          : 'считаем содержимое…'}
      . Восстановить её будет невозможно.
    </DangerConfirmDialog>
  );
}

/** Перед окончательным удалением колонки показываем, сколько карточек уйдёт вместе с ней. */
function ColumnDeleteDialog({ row, onConfirm, onClose }: { row: ArchiveRow; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .countColumnTasks(row.id)
      .then((n) => !cancelled && setCount(n))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  return (
    <DangerConfirmDialog
      title="Удалить колонку навсегда?"
      confirmLabel="Удалить колонку и карточки"
      phrase={row.title}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      Колонка «{row.title}» будет удалена вместе со всеми своими карточками:{' '}
      {count !== null
        ? `${count} ${plural(count, 'карточка', 'карточки', 'карточек')} (активные, архивные и из корзины)`
        : failed
          ? 'посчитать их не удалось'
          : 'считаем…'}
      . Восстановить ничего не получится. Если нужны эти карточки, сначала верни колонку и перенеси их в другую.
    </DangerConfirmDialog>
  );
}

/** Перед окончательным удалением базы знаний показываем, сколько в ней статей. */
function BaseDeleteDialog({ row, onConfirm, onClose }: { row: ArchiveRow; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .countBaseArticles(row.id)
      .then((n) => !cancelled && setCount(n))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  return (
    <DangerConfirmDialog
      title="Удалить базу знаний навсегда?"
      confirmLabel="Удалить навсегда"
      phrase={row.title}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      База знаний «{row.title}» будет удалена вместе со всеми статьями:{' '}
      {count !== null ? `${count} ${plural(count, 'статья', 'статьи', 'статей')} (включая удалённые)` : failed ? 'посчитать не удалось' : 'считаем…'}
      . Восстановить её будет невозможно.
    </DangerConfirmDialog>
  );
}

/** Раздел «Архив и корзина»: поиск, восстановление, окончательное удаление. */
export function ArchiveView() {
  const query = useArchive();
  const actions = useActions();
  const { notify } = useNotice();
  const [tab, setTab] = useState<Tab>('tasks');
  const [search, setSearch] = useState('');
  const [boardFilter, setBoardFilter] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const data = query.data;
  const all = useMemo(
    () =>
      data
        ? {
            boards: boardRows(data),
            columns: columnRows(data),
            tasks: archivedTaskRows(data),
            trash: trashRows(data),
            knowledge: knowledgeRows(data),
          }
        : { boards: [], columns: [], tasks: [], trash: [], knowledge: [] },
    [data],
  );

  const rows = filterRows(all[tab], search, tab === 'boards' || tab === 'knowledge' || boardFilter === '' ? null : boardFilter);

  async function restore(row: ArchiveRow) {
    setBusyId(row.id);
    try {
      if (tab === 'boards') await actions.setBoardArchived(row.id, false);
      else if (tab === 'columns') await actions.restoreColumn(row.id);
      else if (tab === 'tasks') await actions.restoreTask(row.id);
      else if (tab === 'knowledge') {
        if (row.kind === 'base') await actions.setKnowledgeBaseArchived(row.id, false);
        else await actions.restoreArticle(row.id);
      } else await actions.restoreTaskFromTrash(row.id);
    } catch (e) {
      notify(`Не удалось восстановить: ${errText(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  const emptyText: Record<Tab, string> = {
    boards: 'Архивных досок нет.',
    columns: 'Архивных колонок нет.',
    tasks: 'Архивных карточек нет.',
    trash: 'Корзина пуста.',
    knowledge: 'Архивных баз знаний и удалённых статей нет.',
  };

  return (
    <div className="archive">
      <div className="archive-tabs" role="tablist">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'view-tab active' : 'view-tab'}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]} <span className="muted">{all[t].length}</span>
          </button>
        ))}
      </div>

      <div className="archive-tools">
        <input
          className="field search"
          type="search"
          placeholder="Поиск по названию…"
          aria-label="Поиск в архиве"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {tab !== 'boards' && tab !== 'knowledge' && data && (
          <select className="field small" aria-label="Доска" value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)}>
            <option value="">Все доски</option>
            {data.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.archived_at ? ' (в архиве)' : ''}
              </option>
            ))}
          </select>
        )}
        {tab === 'trash' && all.trash.length > 0 && (
          <button className="btn small danger" type="button" onClick={() => setPending({ kind: 'emptyTrash', count: all.trash.length })}>
            Очистить корзину
          </button>
        )}
      </div>

      {tab === 'trash' && (
        <p className="muted small-note">
          Удалённые карточки лежат здесь, пока их не удалят насовсем. В поиск, представления и экспорт они не попадают.
        </p>
      )}
      {tab === 'columns' && (
        <p className="muted small-note">
          Архивную колонку можно вернуть на доску или удалить насовсем: тогда вместе с ней удалятся все её карточки.
        </p>
      )}
      {tab === 'knowledge' && (
        <p className="muted small-note">Здесь архивные базы знаний и удалённые статьи. Статья возвращается в свою базу знаний.</p>
      )}
      {tab === 'tasks' && (
        <p className="muted small-note">Архивные карточки остаются частью работы: их можно вернуть на доску в любой момент.</p>
      )}

      {query.isLoading && <div className="muted">Загружаем…</div>}
      {query.isError && (
        <div className="error">
          {errText(query.error)}{' '}
          <button className="btn small" type="button" onClick={() => void query.refetch()}>
            Повторить
          </button>
        </div>
      )}
      {!query.isLoading && !query.isError && rows.length === 0 && (
        <div className="muted archive-empty">{search.trim() !== '' || boardFilter !== '' ? 'Ничего не найдено.' : emptyText[tab]}</div>
      )}

      <div className="archive-list">
        {rows.map((row) => (
          <div key={row.id} className="archive-row">
            <div className="archive-main">
              <div className="archive-title">{row.title}</div>
              {row.subtitle !== '' && <div className="muted small-text">{row.subtitle}</div>}
              {row.note && <div className="archive-note small-text">{row.note}</div>}
              {row.when && (
                <div className="muted small-text">
                  {tab === 'trash' || row.kind === 'article' ? 'Удалено' : 'В архиве с'} {formatWhen(row.when)}
                </div>
              )}
            </div>
            <div className="archive-actions">
              <button className="btn small" type="button" disabled={busyId === row.id} onClick={() => void restore(row)}>
                Восстановить
              </button>
              {tab === 'columns' && (
                <button className="btn small danger" type="button" onClick={() => setPending({ kind: 'column', row })}>
                  Удалить навсегда
                </button>
              )}
              {tab === 'boards' && (
                <button className="btn small danger" type="button" onClick={() => setPending({ kind: 'board', row })}>
                  Удалить навсегда
                </button>
              )}
              {tab === 'trash' && (
                <button className="btn small danger" type="button" onClick={() => setPending({ kind: 'task', row })}>
                  Удалить навсегда
                </button>
              )}
              {tab === 'knowledge' && (
                <button
                  className="btn small danger"
                  type="button"
                  onClick={() => setPending({ kind: row.kind === 'base' ? 'base' : 'article', row })}
                >
                  Удалить навсегда
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {pending?.kind === 'board' && (
        <BoardDeleteDialog row={pending.row} onConfirm={() => actions.deleteBoardForever(pending.row.id)} onClose={() => setPending(null)} />
      )}
      {pending?.kind === 'task' && (
        <DangerConfirmDialog
          title="Удалить карточку навсегда?"
          confirmLabel="Удалить навсегда"
          phrase="удалить"
          onConfirm={() => actions.deleteTaskForever(pending.row.id)}
          onClose={() => setPending(null)}
        >
          Карточка «{pending.row.title}» будет удалена вместе с описанием и значениями свойств. Восстановить её будет невозможно.
        </DangerConfirmDialog>
      )}
      {pending?.kind === 'column' && (
        <ColumnDeleteDialog
          row={pending.row}
          onConfirm={async () => {
            const n = await actions.deleteColumnForever(pending.row.id);
            notify(`Колонка удалена вместе с карточками: ${n}.`, 'info');
          }}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'base' && (
        <BaseDeleteDialog row={pending.row} onConfirm={() => actions.deleteKnowledgeBaseForever(pending.row.id)} onClose={() => setPending(null)} />
      )}
      {pending?.kind === 'article' && (
        <DangerConfirmDialog
          title="Удалить статью навсегда?"
          confirmLabel="Удалить навсегда"
          phrase="удалить"
          onConfirm={() => actions.deleteArticleForever(pending.row.id)}
          onClose={() => setPending(null)}
        >
          Статья «{pending.row.title}» будет удалена вместе с текстом. Восстановить её будет невозможно.
        </DangerConfirmDialog>
      )}
      {pending?.kind === 'emptyTrash' && (
        <DangerConfirmDialog
          title="Очистить корзину?"
          confirmLabel="Удалить всё навсегда"
          phrase="удалить"
          onConfirm={async () => {
            const n = await actions.emptyTrash();
            notify(`Из корзины удалено: ${n} ${plural(n, 'карточка', 'карточки', 'карточек')}.`, 'info');
          }}
          onClose={() => setPending(null)}
        >
          Все карточки из корзины ({pending.count}), на всех досках, будут удалены навсегда. Восстановить их будет невозможно.
        </DangerConfirmDialog>
      )}
    </div>
  );
}
