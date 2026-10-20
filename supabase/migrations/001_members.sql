-- =====================================================================
-- QA Flow · миграция 001 · участники команды и доступ
-- =====================================================================
-- Что делает:
--   1. Создаёт таблицу members — «белый список» людей, которым можно в приложение.
--   2. Создаёт функции is_active_member() и is_admin(), на которые опираются
--      все политики RLS в следующих миграциях.
--   3. Автоматически добавляет в members каждого пользователя, которого ты
--      создаёшь в Supabase (первый становится admin).
--   4. Включает RLS и закрывает таблицу от анонимных запросов.
--
-- Ничего не удаляет и не меняет существующие данные. Безопасно запускать
-- один раз в чистом проекте. Повторный запуск выдаст ошибку «already exists».
-- =====================================================================

create table public.members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  role         text not null default 'member' check (role in ('admin', 'member')),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table public.members enable row level security;

-- ---------------------------------------------------------------------
-- Вспомогательные функции для политик.
-- security definer: читают members в обход RLS (иначе политика на members
-- ссылалась бы сама на себя). search_path зафиксирован для безопасности.
-- ---------------------------------------------------------------------
create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = auth.uid() and m.is_active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = auth.uid() and m.is_active and m.role = 'admin'
  );
$$;

revoke all on function public.is_active_member() from public, anon;
revoke all on function public.is_admin()         from public, anon;
grant execute on function public.is_active_member() to authenticated;
grant execute on function public.is_admin()         to authenticated;

-- ---------------------------------------------------------------------
-- Политики members
--   SELECT: любой активный участник видит список команды.
--   UPDATE: только admin (имя, роль, активность).
--   INSERT/DELETE: политик нет → через API запрещены.
--   Участников добавляет триггер ниже (когда ты создаёшь пользователя).
-- ---------------------------------------------------------------------
create policy members_select on public.members
  for select to authenticated
  using (public.is_active_member());

create policy members_update_admin on public.members
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.members from anon, authenticated;
grant select on public.members to authenticated;
grant update (display_name, role, is_active) on public.members to authenticated;

-- ---------------------------------------------------------------------
-- Автодобавление участника при создании пользователя в Supabase Auth.
-- Имя берётся из user_metadata.display_name, а если его нет — из части
-- адреса до «@». Самый первый пользователь становится admin.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_role text;
begin
  v_name := left(
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Участник'
    ), 60);

  if exists (select 1 from public.members) then
    v_role := 'member';
  else
    v_role := 'admin';
  end if;

  insert into public.members (user_id, display_name, role)
  values (new.id, v_name, v_role);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Если пользователи уже были созданы ДО этой миграции — добавляем их.
-- Самый ранний становится admin, если admin-ов ещё нет.
-- ---------------------------------------------------------------------
insert into public.members (user_id, display_name, role)
select
  u.id,
  left(coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Участник'), 60),
  case
    when row_number() over (order by u.created_at) = 1
         and not exists (select 1 from public.members) then 'admin'
    else 'member'
  end
from auth.users u
where not exists (select 1 from public.members m where m.user_id = u.id);
