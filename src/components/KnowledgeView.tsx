import { lazy, Suspense, useMemo, useState } from 'react';
import { useActions, useArticles } from '../features/boards/hooks';
import { htmlToText } from '../lib/export';
import { plural } from '../lib/format';
import type { KnowledgeArticle, KnowledgeBase } from '../lib/types';
import { BoardDialog } from './BoardDialog';
import { Dialog } from './Dialog';

// Текст статьи тянет Tiptap, Yjs и совместную работу — грузим его только при открытии статьи.
const ArticleDialog = lazy(() => import('./ArticleDialog').then((m) => ({ default: m.ArticleDialog })));

const lower = (s: string) => s.toLocaleLowerCase('ru');

/** Поиск по заголовку, тексту и меткам без учёта регистра. */
function matches(article: KnowledgeArticle, query: string): boolean {
  if (query === '') return true;
  return (
    lower(article.title).includes(query) ||
    lower(article.search_text).includes(query) ||
    article.labels.some((l) => lower(l).includes(query))
  );
}

function excerptOf(article: KnowledgeArticle): string {
  const text = htmlToText(article.search_text).replace(/\s+/g, ' ').trim();
  return text.length > 170 ? `${text.slice(0, 170)}…` : text;
}

const formatWhen = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

/** База знаний: список статей с поиском, метки, редактор в окне. */
export function KnowledgeView({ base }: { base: KnowledgeBase }) {
  const query = useArticles(base.id);
  const actions = useActions();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const articles = useMemo(() => query.data ?? [], [query.data]);
  const q = lower(search.trim());
  const list = useMemo(() => articles.filter((a) => matches(a, q)), [articles, q]);

  return (
    <div className="knowledge">
      <div className="knowledge-tools">
        <input
          className="field search"
          type="search"
          placeholder="Поиск по статьям и меткам…"
          aria-label="Поиск по статьям"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn small primary" type="button" onClick={() => setCreating(true)}>
          ＋ Статья
        </button>
        <span className="muted small-text">
          {q === ''
            ? `${articles.length} ${plural(articles.length, 'статья', 'статьи', 'статей')}`
            : `Найдено ${list.length} из ${articles.length}`}
        </span>
      </div>

      {query.isLoading && <div className="muted">Загружаем статьи…</div>}
      {query.isError && (
        <div className="error">
          {query.error instanceof Error ? query.error.message : 'Не удалось загрузить статьи'}{' '}
          <button className="btn small" type="button" onClick={() => void query.refetch()}>
            Повторить
          </button>
        </div>
      )}
      {!query.isLoading && !query.isError && list.length === 0 && (
        <div className="muted archive-empty">
          {articles.length === 0 ? 'Статей пока нет. Нажми «＋ Статья».' : 'Ничего не найдено.'}
        </div>
      )}

      <div className="knowledge-grid">
        {list.map((a) => (
          <article
            key={a.id}
            className="knowledge-card"
            tabIndex={0}
            onClick={() => setOpen({ id: a.id, title: a.title })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setOpen({ id: a.id, title: a.title });
            }}
          >
            <div className="knowledge-card-title">{a.title}</div>
            <div className="knowledge-card-excerpt">{excerptOf(a) || 'Пустая статья'}</div>
            {a.labels.length > 0 && (
              <div className="label-row">
                {a.labels.map((l) => (
                  <button
                    key={l}
                    type="button"
                    className="chip label-chip"
                    title="Показать статьи с этой меткой"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSearch(l);
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
            <div className="muted small-text">{formatWhen(a.updated_at)}</div>
          </article>
        ))}
      </div>

      {creating && (
        <BoardDialog
          title="Новая статья"
          submitLabel="Создать"
          withDescription={false}
          onSubmit={async (title) => {
            const created = await actions.createArticle(base.id, title);
            setOpen({ id: created.id, title: created.title });
          }}
          onClose={() => setCreating(false)}
        />
      )}
      {open && (
        <Suspense
          fallback={
            <Dialog title="Статья" onClose={() => setOpen(null)} wide>
              <p className="muted">Загрузка редактора…</p>
            </Dialog>
          }
        >
          <ArticleDialog
            key={open.id}
            baseId={base.id}
            articleId={open.id}
            initialTitle={open.title}
            onClose={() => setOpen(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
