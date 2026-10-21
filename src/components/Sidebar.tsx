import type { Board } from '../lib/types';

export function Sidebar({
  boards,
  currentId,
  onSelect,
  onCreate,
}: {
  boards: Board[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <aside className="sidebar" aria-label="Навигация">
      <div className="sidebar-brand">
        <div className="logo small">✦</div>
        <span className="sidebar-title">QA Flow</span>
      </div>

      <div className="sidebar-section-head">
        <span>Доски</span>
        <button className="icon-btn" type="button" title="Создать доску" aria-label="Создать доску" onClick={onCreate}>
          ＋
        </button>
      </div>

      <nav className="sidebar-list">
        {boards.length === 0 && <div className="muted small-text">Досок пока нет</div>}
        {boards.map((b) => (
          <button
            key={b.id}
            type="button"
            className={b.id === currentId ? 'side-item active' : 'side-item'}
            onClick={() => onSelect(b.id)}
            title={b.description ?? b.name}
          >
            {b.name}
          </button>
        ))}
      </nav>
    </aside>
  );
}
