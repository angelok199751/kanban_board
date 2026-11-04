-- =====================================================================
-- QA Flow · миграция 010: совместное редактирование текста статей
-- =====================================================================
-- Текст статьи, как и описание карточки, живёт в CRDT (Yjs): несколько
-- человек могут печатать в одной статье одновременно, правки сливаются.
-- Здесь хранится снимок состояния документа Yjs (в base64), чтобы новый
-- участник получал не только последний HTML, но и всю историю правок.
--
-- Состояние небольшое, поэтому снимок целиком перезаписывается при
-- изменении: так проще и надёжнее, чем журнал правок.
--
-- Внимание: миграцию нужно применить в Supabase вручную (SQL Editor),
-- как и предыдущие.
-- =====================================================================

create table public.article_docs (
  article_id uuid primary key references public.knowledge_articles (id) on delete cascade,
  state      text not null check (char_length(state) <= 2000000),
  updated_at timestamptz not null default now()
);

create trigger article_docs_touch before insert or update on public.article_docs
  for each row execute function public.touch_row();

-- ---------------------------------------------------------------------
-- RLS: как у остальных данных базы знаний — только активным участникам.
-- ---------------------------------------------------------------------
alter table public.article_docs enable row level security;

create policy article_docs_select on public.article_docs for select to authenticated
  using (public.is_active_member());
create policy article_docs_insert on public.article_docs for insert to authenticated
  with check (public.is_active_member());
create policy article_docs_update on public.article_docs for update to authenticated
  using (public.is_active_member()) with check (public.is_active_member());
create policy article_docs_delete on public.article_docs for delete to authenticated
  using (public.is_active_member());

revoke all on public.article_docs from anon, authenticated;
grant select, insert, update, delete on public.article_docs to authenticated;

-- ---------------------------------------------------------------------
-- Версия статьи больше не меняется от правки одного текста.
-- Иначе два человека, печатающие в статье, постоянно «конфликтовали» бы
-- с тем, кто в это время правит заголовок или метки, хотя правки не
-- пересекаются. Заголовок, метки и корзина по-прежнему увеличивают версию.
-- ---------------------------------------------------------------------
create or replace function public.touch_article()
returns trigger
language plpgsql
as $$
begin
  new.id         := old.id;
  new.base_id    := old.base_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.version    := case
    when new.title is distinct from old.title
      or new.labels is distinct from old.labels
      or new.deleted_at is distinct from old.deleted_at
    then old.version + 1
    else old.version
  end;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
