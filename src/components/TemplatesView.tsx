import { useState } from 'react';
import { useActions, useBoards, useTemplates } from '../features/boards/hooks';
import { PROPERTY_TYPE_LABELS, plural } from '../lib/format';
import { useNotice } from '../lib/notice';
import type { Board } from '../lib/types';
import type { BoardTemplate as Template } from '../lib/templates';
import { BoardDialog } from './BoardDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { FormDialog } from './Dialog';
import { IconTemplate } from './Icons';

type DialogState =
  | { kind: 'createBoard'; template: Template }
  | { kind: 'apply'; template: Template }
  | { kind: 'rename'; template: Template }
  | { kind: 'delete'; template: Template }
  | null;

const formatWhen = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

/** Применение шаблона к существующей доске: выбор доски и понятное предупреждение о суффиксах. */
function ApplyTemplateDialog({
  template,
  boards,
  onApply,
  onClose,
}: {
  template: Template;
  boards: Board[];
  onApply: (boardId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [boardId, setBoardId] = useState(boards[0]?.id ?? '');

  return (
    <FormDialog
      title="Применить шаблон к доске"
      submitLabel="Применить"
      onClose={onClose}
      onSubmit={() => onApply(boardId)}
      disabled={boardId === ''}
    >
      <p className="muted small-text">
        Колонки и свойства шаблона «{template.name}» добавятся в конец выбранной доски. Существующие колонки и свойства
        не изменятся, а совпадающие названия получат суффикс «(2)», «(3)» и так далее. Карточки не затрагиваются.
      </p>
      {boards.length === 0 ? (
        <div className="muted">Активных досок нет: сначала создай доску.</div>
      ) : (
        <>
          <label className="label" htmlFor="applyTemplateBoard">
            Доска
          </label>
          <select
            id="applyTemplateBoard"
            className="field"
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </>
      )}
    </FormDialog>
  );
}

/** Раздел «Шаблоны»: сохранённые структуры досок, создание и применение без карточек. */
export function TemplatesView({ onOpenBoard }: { onOpenBoard: (id: string) => void }) {
  const query = useTemplates();
  const boardsQuery = useBoards();
  const actions = useActions();
  const { notify } = useNotice();
  const [dialog, setDialog] = useState<DialogState>(null);

  const templates = query.data ?? [];
  const boards = boardsQuery.data ?? [];

  return (
    <div className="templates">
      <div className="templates-tools">
        <span className="muted small-text">
          {templates.length} {plural(templates.length, 'шаблон', 'шаблона', 'шаблонов')}
        </span>
        <span className="muted small-text">
          Шаблон хранит только колонки, свойства и их настройки — без карточек и значений.
        </span>
      </div>

      {query.isLoading && <div className="muted">Загружаем шаблоны…</div>}
      {query.isError && (
        <div className="error">
          {query.error instanceof Error ? query.error.message : 'Не удалось загрузить шаблоны'}{' '}
          <button className="btn small" type="button" onClick={() => void query.refetch()}>
            Повторить
          </button>
        </div>
      )}
      {!query.isLoading && !query.isError && templates.length === 0 && (
        <div className="muted archive-empty">
          Шаблонов пока нет. Открой доску и нажми «Шаблон» на панели инструментов, чтобы сохранить её структуру.
        </div>
      )}

      <div className="templates-grid">
        {templates.map((template) => {
          const structure = template.structure;
          return (
            <article key={template.id} className="template-card">
              <div className="template-card-head">
                <h3 className="template-card-title">
                  <IconTemplate size={15} /> {template.name}
                </h3>
                <span className="muted small-text template-card-when" title="Когда шаблон сохранён или изменён">
                  {formatWhen(template.updated_at)}
                </span>
              </div>

              <div className="template-counts">
                <span>
                  {structure.columns.length} {plural(structure.columns.length, 'колонка', 'колонки', 'колонок')}
                </span>
                <span>
                  {structure.properties.length} {plural(structure.properties.length, 'свойство', 'свойства', 'свойств')}
                </span>
              </div>

              <div>
                <div className="template-section-label">Колонки</div>
                <div className="template-chips">
                  {structure.columns.length === 0 && <span className="muted small-text">Нет колонок</span>}
                  {structure.columns.map((column, index) => (
                    <span key={`${column.name}-${index}`} className={`pill c-${column.color}`}>
                      {column.name}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className="template-section-label">Свойства</div>
                {structure.properties.length === 0 ? (
                  <span className="muted small-text">Нет свойств</span>
                ) : (
                  <div className="template-props">
                    {structure.properties.map((property, index) => {
                      const options =
                        property.type === 'select' && property.options.length > 0
                          ? ` · ${property.options.length} ${plural(property.options.length, 'вариант', 'варианта', 'вариантов')}`
                          : '';
                      return (
                        <div key={`${property.name}-${index}`} className="template-prop">
                          <span className="template-prop-name" title={property.name}>
                            {property.name}
                            {property.multiple ? ' · несколько' : ''}
                            {property.hidden ? ' · скрыто' : ''}
                          </span>
                          <span className="template-prop-type">
                            {PROPERTY_TYPE_LABELS[property.type]}
                            {options}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="template-actions">
                <button className="btn small primary" type="button" onClick={() => setDialog({ kind: 'createBoard', template })}>
                  Создать доску
                </button>
                <button
                  className="btn small"
                  type="button"
                  disabled={boards.length === 0}
                  title={boards.length === 0 ? 'Нет активных досок' : 'Добавить структуру шаблона в доску'}
                  onClick={() => setDialog({ kind: 'apply', template })}
                >
                  Применить
                </button>
                <button className="btn small" type="button" onClick={() => setDialog({ kind: 'rename', template })}>
                  Переименовать
                </button>
                <button className="btn small danger" type="button" onClick={() => setDialog({ kind: 'delete', template })}>
                  Удалить
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {dialog?.kind === 'createBoard' && (
        <BoardDialog
          title="Новая доска из шаблона"
          submitLabel="Создать"
          initialName={dialog.template.name}
          withDescription={false}
          onSubmit={async (name) => {
            const created = await actions.createBoardFromTemplate(dialog.template, name);
            notify('Доска создана из шаблона');
            onOpenBoard(created.id);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'apply' && (
        <ApplyTemplateDialog
          template={dialog.template}
          boards={boards}
          onApply={async (boardId) => {
            await actions.applyTemplate(boardId, dialog.template);
            const board = boards.find((b) => b.id === boardId);
            notify(board ? `Шаблон применён к доске «${board.name}»` : 'Шаблон применён к доске');
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <BoardDialog
          title="Переименовать шаблон"
          submitLabel="Сохранить"
          withDescription={false}
          initialName={dialog.template.name}
          onSubmit={(name) => actions.renameTemplate(dialog.template.id, name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Удалить шаблон?"
          confirmLabel="Удалить шаблон"
          onConfirm={async () => {
            await actions.deleteTemplate(dialog.template.id);
            notify('Шаблон удалён');
          }}
          onClose={() => setDialog(null)}
        >
          Шаблон «{dialog.template.name}» будет удалён навсегда. Доски, созданные по нему или к которым его применяли,
          останутся без изменений.
        </ConfirmDialog>
      )}
    </div>
  );
}
