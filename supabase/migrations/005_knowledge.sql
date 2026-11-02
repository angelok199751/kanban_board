-- =====================================================================
-- QA Flow · миграция 005 · базы знаний и статьи
-- =====================================================================
-- Что делает: добавляет две таблицы, knowledge_bases (базы знаний) и
-- knowledge_articles (статьи), с теми же правилами безопасности, что у задач:
--   * доступ только у активных участников (RLS);
--   * у статьи есть номер версии: сохранение «если версия не изменилась»
--     не даёт молча затереть чужую правку;
--   * статью нельзя удалить насовсем, пока она не в корзине (deleted_at);
--   * базу нельзя удалить насовсем, пока она не в архиве (archived_at);
--   * search_text: текст статьи без HTML-тегов для поиска.
--
-- Что НЕ делает: ничего не удаляет и не меняет в существующих данных.
-- Выполнять после 001-004, один раз.
-- =====================================================================

create table public.knowledge_bases (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 100),
  position    text collate "C" not null,
  archived_at timestamptz,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger knowledge_bases_touch before update on public.knowledge_bases
  for each row execute function public.touch_row();

create table public.knowledge_articles (
  id           uuid primary key default gen_random_uuid(),
  base_id      uuid not null references public.knowledge_bases (id) on delete cascade,
  title        text not null check (char_length(btrim(title)) between 1 and 300),
  content_html text not null default '' check (char_length(content_html) <= 200000),
  labels       text[] not null default '{}' check (cardinality(labels) <= 20),
  version      integer not null default 1,
  deleted_at   timestamptz,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  search_text  text generated always as (regexp_replace(content_html, '<[^>]*>', ' ', 'g')) stored
);

create index knowledge_articles_base_idx on public.knowledge_articles (base_id) where deleted_at is null;
create index knowledge_articles_deleted_idx on public.knowledge_articles (base_id) where deleted_at is not null;

-- При каждом изменении: версия +1, кто и когда изменил; неизменяемые поля защищены.
create or replace function public.touch_article()
returns trigger
language plpgsql
as $$
begin
  new.id         := old.id;
  new.base_id    := old.base_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.version    := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger knowledge_articles_touch before update on public.knowledge_articles
  for each row execute function public.touch_article();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.knowledge_bases    enable row level security;
alter table public.knowledge_articles enable row level security;

create policy kbases_select on public.knowledge_bases for select to authenticated
  using (public.is_active_member());
create policy kbases_insert on public.knowledge_bases for insert to authenticated
  with check (public.is_active_member());
create policy kbases_update on public.knowledge_bases for update to authenticated
  using (public.is_active_member()) with check (public.is_active_member());
create policy kbases_delete on public.knowledge_bases for delete to authenticated
  using (public.is_active_member() and archived_at is not null);

create policy karticles_select on public.knowledge_articles for select to authenticated
  using (public.is_active_member());
create policy karticles_insert on public.knowledge_articles for insert to authenticated
  with check (public.is_active_member());
create policy karticles_update on public.knowledge_articles for update to authenticated
  using (public.is_active_member()) with check (public.is_active_member());
create policy karticles_delete on public.knowledge_articles for delete to authenticated
  using (public.is_active_member() and deleted_at is not null);

-- ---------------------------------------------------------------------
-- Права доступа: аноним не получает ничего
-- ---------------------------------------------------------------------
revoke all on public.knowledge_bases, public.knowledge_articles from anon, authenticated;
grant select, delete on public.knowledge_bases to authenticated;
grant insert (name, position)                  on public.knowledge_bases to authenticated;
grant update (name, position, archived_at)     on public.knowledge_bases to authenticated;
grant select, insert, update, delete on public.knowledge_articles to authenticated;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
alter table public.knowledge_bases    replica identity full;
alter table public.knowledge_articles replica identity full;
alter publication supabase_realtime add table public.knowledge_bases, public.knowledge_articles;
