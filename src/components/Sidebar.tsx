import type { Board, KnowledgeBase } from '../lib/types';
import { IconTrash } from './Icons';

export function Sidebar({
  boards,
  currentId,
  bases,
  currentBaseId,
  archiveActive,
  onSelect,
  onCreate,
  onSelectBase,
  onCreateBase,
  onArchive,
}: {
  boards: Board[];
  currentId: string | null;
  bases: KnowledgeBase[];
  currentBaseId: string | null;
  archiveActive: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onSelectBase: (id: string) => void;
  onCreateBase: () => void;
  onArchive: () => void;
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

      <div className="sidebar-section-head">
        <span>Базы знаний</span>
        <button className="icon-btn" type="button" title="Создать базу знаний" aria-label="Создать базу знаний" onClick={onCreateBase}>
          ＋
        </button>
      </div>
      <nav className="sidebar-list">
        {bases.length === 0 && <div className="muted small-text">Баз знаний пока нет</div>}
        {bases.map((b) => (
          <button
            key={b.id}
            type="button"
            className={b.id === currentBaseId ? 'side-item active' : 'side-item'}
            onClick={() => onSelectBase(b.id)}
          >
            {b.name}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button type="button" className={archiveActive ? 'side-item active with-icon' : 'side-item with-icon'} onClick={onArchive}>
          <IconTrash />
          <span>Архив и корзина</span>
        </button>
      </div>
    </aside>
  );
}
