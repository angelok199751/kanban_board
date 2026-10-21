import { useEffect, useMemo, useState } from 'react';
import { useAuth, type Member } from '../auth/AuthProvider';
import { useActions, useBoards } from '../features/boards/hooks';
import { compareByPosition } from '../lib/positions';
import { useBoardRoute } from '../lib/route';
import { BoardDialog } from './BoardDialog';
import { BoardView } from './BoardView';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { Sidebar } from './Sidebar';

type ShellDialog = 'newBoard' | 'renameBoard' | 'password' | null;

const SIDEBAR_KEY = 'qaflow.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

export function Shell({ member }: { member: Member }) {
  const { signOut } = useAuth();
  const boardsQuery = useBoards();
  const actions = useActions();
  const [routeId, go] = useBoardRoute();
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [dialog, setDialog] = useState<ShellDialog>(null);

  const boards = useMemo(() => [...(boardsQuery.data ?? [])].sort(compareByPosition), [boardsQuery.data]);
  const current = boards.find((b) => b.id === routeId) ?? null;

  // Если в адресе нет доски (или её больше нет), открываем первую
  useEffect(() => {
    if (boardsQuery.isSuccess && current === null && boards.length > 0) go(boards[0].id);
  }, [boardsQuery.isSuccess, current, boards, go]);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {
      /* без сохранения настройки */
    }
  }

  let content;
  if (boardsQuery.isError) {
    content = (
      <div className="board-state">
        <div className="error">
          {boardsQuery.error instanceof Error ? boardsQuery.error.message : 'Не удалось загрузить доски'}
        </div>
        <button className="btn" type="button" onClick={() => void boardsQuery.refetch()}>
          Повторить
        </button>
      </div>
    );
  } else if (boardsQuery.isLoading) {
    content = <div className="board-state muted">Загрузка…</div>;
  } else if (current) {
    content = <BoardView key={current.id} board={current} />;
  } else {
    content = (
      <div className="board-state">
        <h2>Здесь пока пусто</h2>
        <p className="muted">Создай первую доску: она будет пустой, колонки и свойства настроишь сама.</p>
        <button className="btn primary" type="button" onClick={() => setDialog('newBoard')}>
          ＋ Создать доску
        </button>
      </div>
    );
  }

  return (
    <div className={collapsed ? 'app-shell collapsed' : 'app-shell'}>
      <Sidebar boards={boards} currentId={current ? current.id : null} onSelect={go} onCreate={() => setDialog('newBoard')} />

      <div className="main">
        <header className="topbar">
          <div className="row">
            <button
              className="icon-btn"
              type="button"
              title={collapsed ? 'Показать панель' : 'Скрыть панель'}
              aria-label={collapsed ? 'Показать панель' : 'Скрыть панель'}
              onClick={toggleSidebar}
            >
              ☰
            </button>
            <h1 className="board-title">{current ? current.name : 'QA Flow'}</h1>
            {current && (
              <button className="icon-btn" type="button" title="Переименовать доску" aria-label="Переименовать доску" onClick={() => setDialog('renameBoard')}>
                ✎
              </button>
            )}
          </div>
          <div className="row">
            <span className="muted">
              {member.display_name}
              {member.role === 'admin' ? ' · админ' : ''}
            </span>
            <button className="btn small" type="button" onClick={() => setDialog('password')}>
              Сменить пароль
            </button>
            <button className="btn small" type="button" onClick={() => void signOut()}>
              Выйти
            </button>
          </div>
        </header>

        {content}
      </div>

      {dialog === 'newBoard' && (
        <BoardDialog
          title="Новая доска"
          submitLabel="Создать"
          onSubmit={async (name, description) => {
            const created = await actions.createBoard(name, description);
            go(created.id);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'renameBoard' && current && (
        <BoardDialog
          title="Переименовать доску"
          submitLabel="Сохранить"
          initialName={current.name}
          initialDescription={current.description ?? ''}
          onSubmit={(name, description) => actions.renameBoard(current.id, name, description)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'password' && <ChangePasswordDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
