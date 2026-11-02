import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, type Member } from '../auth/AuthProvider';
import { useActions, useBoards, useKnowledgeBases } from '../features/boards/hooks';
import { useRealtimeSync } from '../features/boards/useRealtimeSync';
import { compareByPosition } from '../lib/positions';
import { useRoute } from '../lib/route';
import { useTheme } from '../lib/theme';
import { ArchiveView } from './ArchiveView';
import { BoardDialog } from './BoardDialog';
import { BoardView } from './BoardView';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { KnowledgeView } from './KnowledgeView';
import { IconArchive } from './Icons';
import { Sidebar } from './Sidebar';
import { ThemeDialog } from './ThemeDialog';

type ShellDialog =
  | 'newBoard'
  | 'renameBoard'
  | 'archiveBoard'
  | 'newBase'
  | 'renameBase'
  | 'archiveBase'
  | 'password'
  | 'theme'
  | null;

const SIDEBAR_KEY = 'qaflow.sidebarCollapsed';

/**
 * Выполняет действие, только если условие держится delayMs подряд. Нужно для «адрес указывает на то, чего нет в списке»:
 * сразу после создания доски адрес может обогнать обновление списка, и уводить человека с неё нельзя.
 */
function useConfirmedAction(condition: boolean, delayMs: number, action: () => void) {
  const latest = useRef(action);
  latest.current = action;
  useEffect(() => {
    if (!condition) return;
    const id = window.setTimeout(() => latest.current(), delayMs);
    return () => window.clearTimeout(id);
  }, [condition, delayMs]);
}

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
  const basesQuery = useKnowledgeBases();
  const actions = useActions();
  const syncStatus = useRealtimeSync();
  const theme = useTheme();
  const { route, toBoard: go, toKnowledge, toArchive } = useRoute();
  const inArchive = route.kind === 'archive';
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [dialog, setDialog] = useState<ShellDialog>(null);

  const boards = useMemo(() => [...(boardsQuery.data ?? [])].sort(compareByPosition), [boardsQuery.data]);
  const bases = useMemo(() => [...(basesQuery.data ?? [])].sort(compareByPosition), [basesQuery.data]);
  const current = route.kind === 'board' ? (boards.find((b) => b.id === route.id) ?? null) : null;
  const currentBase = route.kind === 'kb' ? (bases.find((b) => b.id === route.id) ?? null) : null;

  // Если в адресе нет доски, открываем первую сразу; если в адресе чужой или старый id, подтверждаем паузой
  const boardMissing = route.kind === 'board' && boardsQuery.isSuccess && current === null && boards.length > 0;
  useConfirmedAction(boardMissing, route.kind === 'board' && route.id === null ? 0 : 800, () => go(boards[0].id));

  // База знаний из адреса исчезла (например, её убрали в архив): возвращаемся к доскам
  const baseMissing = route.kind === 'kb' && basesQuery.isSuccess && currentBase === null;
  useConfirmedAction(baseMissing, 800, () => go(null));

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
  if (inArchive) {
    content = <ArchiveView />;
  } else if (route.kind === 'kb') {
    content = currentBase ? (
      <KnowledgeView key={currentBase.id} base={currentBase} />
    ) : (
      <div className="board-state muted">Загрузка…</div>
    );
  } else if (boardsQuery.isError) {
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
    content = <BoardView key={current.id} board={current} boards={boards} />;
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

  const title = inArchive ? 'Архив и корзина' : currentBase ? currentBase.name : current ? current.name : 'QA Flow';

  return (
    <div className={collapsed ? 'app-shell collapsed' : 'app-shell'}>
      <Sidebar
        boards={boards}
        currentId={current ? current.id : null}
        bases={bases}
        currentBaseId={currentBase ? currentBase.id : null}
        archiveActive={inArchive}
        onSelect={go}
        onCreate={() => setDialog('newBoard')}
        onSelectBase={toKnowledge}
        onCreateBase={() => setDialog('newBase')}
        onArchive={toArchive}
      />

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
            <h1 className="board-title">{title}</h1>
            {current && (
              <>
                <button className="icon-btn" type="button" title="Переименовать доску" aria-label="Переименовать доску" onClick={() => setDialog('renameBoard')}>
                  ✎
                </button>
                <button className="icon-btn" type="button" title="Убрать доску в архив" aria-label="Убрать доску в архив" onClick={() => setDialog('archiveBoard')}>
                  <IconArchive />
                </button>
              </>
            )}
            {currentBase && (
              <>
                <button className="icon-btn" type="button" title="Переименовать базу знаний" aria-label="Переименовать базу знаний" onClick={() => setDialog('renameBase')}>
                  ✎
                </button>
                <button className="icon-btn" type="button" title="Убрать базу знаний в архив" aria-label="Убрать базу знаний в архив" onClick={() => setDialog('archiveBase')}>
                  <IconArchive />
                </button>
              </>
            )}
          </div>
          <div className="row">
            <span
              className={`sync sync-${syncStatus}`}
              role="status"
              title={
                syncStatus === 'online'
                  ? 'Изменения других участников приходят сами'
                  : syncStatus === 'connecting'
                    ? 'Подключаемся…'
                    : 'Нет связи: изменения не сохраняются и не приходят. Когда связь вернётся, данные обновятся сами.'
              }
            >
              {syncStatus === 'offline' ? 'Нет связи' : syncStatus === 'connecting' ? 'Подключение…' : ''}
            </span>
            <span className="muted">
              {member.display_name}
              {member.role === 'admin' ? ' · админ' : ''}
            </span>
            <button className="btn small icon" type="button" title="Тема интерфейса" aria-label="Тема интерфейса" onClick={() => setDialog('theme')}>
              🎨
            </button>
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
      {dialog === 'archiveBoard' && current && (
        <ConfirmDialog
          title="Убрать доску в архив?"
          confirmLabel="Убрать в архив"
          onConfirm={() => actions.setBoardArchived(current.id, true)}
          onClose={() => setDialog(null)}
        >
          Доска «{current.name}» пропадёт из списка вместе со своими колонками и карточками. Ничего не удаляется: вернуть
          её можно в разделе «Архив и корзина».
        </ConfirmDialog>
      )}

      {dialog === 'newBase' && (
        <BoardDialog
          title="Новая база знаний"
          submitLabel="Создать"
          withDescription={false}
          onSubmit={async (name) => {
            const created = await actions.createKnowledgeBase(name);
            toKnowledge(created.id);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'renameBase' && currentBase && (
        <BoardDialog
          title="Переименовать базу знаний"
          submitLabel="Сохранить"
          withDescription={false}
          initialName={currentBase.name}
          onSubmit={(name) => actions.renameKnowledgeBase(currentBase.id, name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'archiveBase' && currentBase && (
        <ConfirmDialog
          title="Убрать базу знаний в архив?"
          confirmLabel="Убрать в архив"
          onConfirm={() => actions.setKnowledgeBaseArchived(currentBase.id, true)}
          onClose={() => setDialog(null)}
        >
          База знаний «{currentBase.name}» пропадёт из списка вместе со статьями. Ничего не удаляется: вернуть её можно в
          разделе «Архив и корзина», вкладка «Знания».
        </ConfirmDialog>
      )}

      {dialog === 'theme' && (
        <ThemeDialog
          mode={theme.mode}
          custom={theme.custom}
          onMode={theme.setMode}
          onCustom={theme.setCustom}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'password' && <ChangePasswordDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
