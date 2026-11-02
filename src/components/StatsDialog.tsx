import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../features/boards/api';
import { COLORS } from '../lib/colors';
import { plural } from '../lib/format';
import { computeStats, percentOf, type Bucket } from '../lib/stats';
import type { BoardData, Task } from '../lib/types';
import { Dialog } from './Dialog';

function Bars({ title, buckets, total }: { title: string; buckets: Bucket[]; total: number }) {
  return (
    <section className="stats-block">
      <div className="label">{title}</div>
      {buckets.map((b) => {
        const pct = percentOf(b.count, total);
        return (
          <div key={b.key} className="bar-row">
            <span className="bar-name" title={b.label}>
              {b.label}
            </span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${pct}%`, minWidth: b.count > 0 ? 4 : 0, background: b.color ? COLORS[b.color] : 'var(--muted)' }} />
            </span>
            <span className="bar-value">
              {b.count} <span className="muted">({pct}%)</span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

/** Статистика по доске: сколько карточек в колонках и по значениям списков. Считается по уже загруженным данным. */
export function StatsDialog({
  boardId,
  data,
  tasks,
  visibleTasks,
  filtersActive,
  onClose,
}: {
  boardId: string;
  data: BoardData;
  tasks: Task[]; // все активные карточки доски
  visibleTasks: Task[]; // подходящие под текущие фильтры и поиск
  filtersActive: boolean;
  onClose: () => void;
}) {
  const [onlyFiltered, setOnlyFiltered] = useState(false);
  const counts = useQuery({ queryKey: ['board-counts', boardId] as const, queryFn: () => api.getBoardCounts(boardId) });

  const scope = onlyFiltered && filtersActive ? visibleTasks : tasks;
  const stats = useMemo(
    () =>
      computeStats({
        columns: data.columns,
        tasks: scope,
        properties: data.properties,
        options: data.options,
        values: data.values,
      }),
    [data, scope],
  );

  return (
    <Dialog title="Статистика доски" wide onClose={onClose}>
      <div className="stats-tiles">
        <div className="stat">
          Активных карточек <strong>{tasks.length}</strong>
        </div>
        <div className="stat">
          Колонок <strong>{data.columns.length}</strong>
        </div>
        <div className="stat">
          В архиве <strong>{counts.data ? counts.data.archived : '…'}</strong>
        </div>
        <div className="stat">
          В корзине <strong>{counts.data ? counts.data.trashed : '…'}</strong>
        </div>
      </div>

      <label className={filtersActive ? 'check-line' : 'check-line disabled'}>
        <input type="checkbox" checked={onlyFiltered && filtersActive} disabled={!filtersActive} onChange={(e) => setOnlyFiltered(e.target.checked)} />
        Считать только карточки по текущим фильтрам и поиску
        {filtersActive && (
          <span className="muted small-text">
            ({visibleTasks.length} из {tasks.length})
          </span>
        )}
      </label>

      {stats.total === 0 ? (
        <p className="muted">В выборке нет карточек.</p>
      ) : (
        <>
          <p className="muted small-note">
            В выборке: {stats.total} {plural(stats.total, 'карточка', 'карточки', 'карточек')}. Архивные и удалённые в
            разбивку не входят.
          </p>
          <Bars title="По колонкам" buckets={stats.byColumn} total={stats.total} />
          {stats.byProperty.map((p) => (
            <Bars key={p.propertyId} title={p.name} buckets={p.buckets} total={stats.total} />
          ))}
          {stats.byProperty.length === 0 && (
            <p className="muted small-note">Разбивка по свойствам появится, когда на доске будут свойства типа «Выпадающий список».</p>
          )}
        </>
      )}

      <div className="row end">
        <button className="btn primary" type="button" onClick={onClose}>
          Готово
        </button>
      </div>
    </Dialog>
  );
}
