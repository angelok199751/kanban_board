-- QA Flow: права доступа (этап 1). Row Level Security на всех таблицах.
-- Принцип: без входа данных нет; после входа — только активные участники из profiles.

-- ---------------------------------------------------------------------------
-- Включаем RLS и снимаем лишние права
-- ---------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.boards              enable row level security;
alter table public.knowledge_bases     enable row level security;
alter table public.board_properties    enable row level security;
alter table public.property_options    enable row level security;
alter table public.board_columns       enable row level security;
alter table public.tasks               enable row level security;
alter table public.board_views         enable row level security;
alter table public.knowledge_articles  enable row level security;
alter table public.import_reports      enable row level security;

revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all tables    in schema public from authenticated;
revoke all on public.import_reports from authenticated;

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on
  public.boards, public.knowledge_bases, public.board_properties, public.property_options,
  public.board_columns, public.tasks, public.board_views, public.knowledge_articles
  to authenticated;

-- Функции: вызывать может только вошедший пользователь.
revoke execute on all functions in schema public from public;
grant execute on function
  public.is_member(),
  public.reorder_columns(uuid, uuid[]),
  public.archive_column(uuid),
  public.restore_column(uuid),
  public.restore_task(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Политики
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (public.is_member());

-- Свои настройки (тема и т. п.) — только свою строку; статус active и ник менять нельзя.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (public.is_member() and id = auth.uid())
  with check (public.is_member() and id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (display_name, settings) on public.profiles to authenticated;

-- Общие таблицы: полный доступ участникам.
do $$
declare
  t text;
begin
  foreach t in array array[
    'boards','knowledge_bases','board_properties','property_options','board_columns','knowledge_articles'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())',
      t || '_all', t);
  end loop;
end $$;

-- Задачи: окончательно удалить можно только то, что уже в корзине.
drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists tasks_delete on public.tasks;
create policy tasks_select on public.tasks for select to authenticated using (public.is_member());
create policy tasks_insert on public.tasks for insert to authenticated with check (public.is_member());
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_member()) with check (public.is_member());
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_member() and deleted_at is not null);

-- Представления: общее (owner_id is null) видят и меняют все; личные — только владелец.
drop policy if exists board_views_select on public.board_views;
drop policy if exists board_views_insert on public.board_views;
drop policy if exists board_views_update on public.board_views;
drop policy if exists board_views_delete on public.board_views;
create policy board_views_select on public.board_views for select to authenticated
  using (public.is_member() and (owner_id is null or owner_id = auth.uid()));
create policy board_views_insert on public.board_views for insert to authenticated
  with check (public.is_member() and owner_id = auth.uid() and not is_default);
create policy board_views_update on public.board_views for update to authenticated
  using (public.is_member() and (owner_id is null or owner_id = auth.uid()))
  with check (public.is_member() and ((owner_id = auth.uid() and not is_default) or (owner_id is null and is_default)));
create policy board_views_delete on public.board_views for delete to authenticated
  using (public.is_member() and owner_id = auth.uid());

-- import_reports: политик нет → доступна только роли postgres (SQL Editor).

-- ---------------------------------------------------------------------------
-- Realtime: изменения приходят всем открытым вкладкам
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'tasks','board_columns','board_properties','property_options','board_views',
      'boards','knowledge_bases','knowledge_articles'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- Для DELETE-событий Realtime нужен полный старый ряд.
alter table public.tasks              replica identity full;
alter table public.board_columns      replica identity full;
alter table public.board_views        replica identity full;
alter table public.knowledge_articles replica identity full;
