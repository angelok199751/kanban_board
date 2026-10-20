-- =====================================================================
-- QA Flow · миграция 002 · доски, колонки, свойства, задачи, представления
-- =====================================================================
-- Что делает: создаёт таблицы канбана, ограничения, триггеры и политики RLS.
-- Ничего не удаляет. Требует, чтобы миграция 001 уже была выполнена.
--
-- Принципы защиты данных (из ТЗ, разделы 5-7, 11):
--   * Колонку нельзя удалить, пока в ней есть задачи (внешний ключ).
--   * Доску, колонку и свойство можно удалить насовсем только после архивации.
--   * Задачу можно удалить насовсем только из корзины (deleted_at не пустой).
--   * Тип свойства нельзя сменить, если у него уже есть значения.
--   * Вариант списка нельзя удалить, пока он выбран хотя бы в одной задаче.
--   * Все проверки работают в базе, а не только в интерфейсе.
--
-- Порядок (position): текстовые ключи для библиотеки fractional-indexing.
-- Перенос одной карточки меняет одну строку, а не всю колонку.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Общий триггер «обновить updated_at»
-- ---------------------------------------------------------------------
create or replace function public.touch_row()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Доски
-- ---------------------------------------------------------------------
create table public.boards (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(btrim(name)) between 1 and 100),
  description      text check (description is null or char_length(description) <= 500),
  position         text collate "C" not null,
  next_task_number integer not null default 1,
  archived_at      timestamptz,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger boards_touch before update on public.boards
  for each row execute function public.touch_row();

-- ---------------------------------------------------------------------
-- Колонки доски
-- ---------------------------------------------------------------------
create table public.board_columns (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  color       text not null default 'gray'
              check (color in ('red','orange','yellow','green','blue','purple','pink','gray')),
  position    text collate "C" not null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, board_id)  -- нужно для составного внешнего ключа из tasks
);

create index board_columns_board_idx on public.board_columns (board_id);

create trigger board_columns_touch before update on public.board_columns
  for each row execute function public.touch_row();

-- ---------------------------------------------------------------------
-- Свойства задач (4 типа по ТЗ)
-- ---------------------------------------------------------------------
create table public.properties (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  type        text not null check (type in ('select', 'text', 'url', 'date')),
  position    text collate "C" not null,
  hidden      boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index properties_board_idx on public.properties (board_id);
-- имена активных свойств внутри доски не повторяются
create unique index properties_name_uniq
  on public.properties (board_id, lower(btrim(name)))
  where archived_at is null;

create trigger properties_touch before update on public.properties
  for each row execute function public.touch_row();

-- Смена типа запрещена, если у свойства уже есть значения.
create or replace function public.guard_property_type_change()
returns trigger
language plpgsql
as $$
begin
  if new.type is distinct from old.type
     and exists (select 1 from public.task_values v where v.property_id = old.id) then
    raise exception 'Нельзя сменить тип свойства: у него уже есть значения в задачах'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Варианты выпадающих списков
-- ---------------------------------------------------------------------
create table public.property_options (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 60),
  color       text not null default 'gray'
              check (color in ('red','orange','yellow','green','blue','purple','pink','gray')),
  position    text collate "C" not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index property_options_property_idx on public.property_options (property_id);
create unique index property_options_label_uniq
  on public.property_options (property_id, lower(btrim(label)));

create trigger property_options_touch before update on public.property_options
  for each row execute function public.touch_row();

-- Варианты бывают только у свойств типа «список».
create or replace function public.guard_option_property()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.properties p where p.id = new.property_id and p.type = 'select'
  ) then
    raise exception 'Варианты можно добавлять только к свойству типа «Выпадающий список»'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger property_options_guard before insert on public.property_options
  for each row execute function public.guard_option_property();

-- ---------------------------------------------------------------------
-- Задачи
-- ---------------------------------------------------------------------
create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  board_id         uuid not null references public.boards (id) on delete cascade,
  column_id        uuid not null,
  number           integer not null,
  title            text not null check (char_length(btrim(title)) between 1 and 300),
  description_html text not null default '' check (char_length(description_html) <= 200000),
  position         text collate "C" not null,
  version          integer not null default 1,
  archived_at      timestamptz,
  deleted_at       timestamptz,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (board_id, number),
  -- колонка обязана принадлежать той же доске; удалить колонку с задачами нельзя
  foreign key (column_id, board_id) references public.board_columns (id, board_id)
);

create index tasks_board_column_idx on public.tasks (board_id, column_id, position)
  where deleted_at is null;
create index tasks_board_deleted_idx on public.tasks (board_id) where deleted_at is not null;

-- Номер задачи: атомарно, уникален в пределах доски, назначается автоматически.
create or replace function public.assign_task_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  update public.boards
     set next_task_number = next_task_number + 1
   where id = new.board_id
   returning next_task_number - 1 into v_number;

  if v_number is null then
    raise exception 'Доска не найдена' using errcode = '23503';
  end if;

  new.number := v_number;
  return new;
end;
$$;

create trigger tasks_assign_number before insert on public.tasks
  for each row execute function public.assign_task_number();

-- При каждом изменении: версия +1, кто и когда изменил; неизменяемые поля защищены.
-- Клиент сохраняет так: update ... where id = :id and version = :seen_version.
-- Если 0 строк обновлено — кто-то успел раньше (конфликт), и интерфейс это покажет.
create or replace function public.touch_task()
returns trigger
language plpgsql
as $$
begin
  new.id         := old.id;
  new.board_id   := old.board_id;
  new.number     := old.number;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.version    := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_task();

-- ---------------------------------------------------------------------
-- Значения свойств. Одна строка = одно заполненное свойство задачи.
-- Пустое значение = строки нет (клиент её удаляет).
--   select  -> option_id (хранится ссылка, поэтому переименование варианта
--              не теряет значения)
--   text    -> value_text
--   url     -> value_text (проверяется формат http/https)
--   date    -> value_date (тип date, без часового пояса и сдвига дня)
-- ---------------------------------------------------------------------
create table public.task_values (
  task_id     uuid not null references public.tasks (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  value_text  text check (value_text is null or char_length(value_text) <= 2000),
  value_date  date,
  option_id   uuid references public.property_options (id),
  updated_at  timestamptz not null default now(),
  primary key (task_id, property_id)
);

create index task_values_property_idx on public.task_values (property_id);
create index task_values_option_idx   on public.task_values (option_id) where option_id is not null;

create trigger task_values_touch before update on public.task_values
  for each row execute function public.touch_row();

create or replace function public.validate_task_value()
returns trigger
language plpgsql
as $$
declare
  t_board  uuid;
  p_board  uuid;
  p_type   text;
  o_prop   uuid;
begin
  select board_id into t_board from public.tasks where id = new.task_id;
  select board_id, type into p_board, p_type from public.properties where id = new.property_id;

  if t_board is null or p_board is null or t_board <> p_board then
    raise exception 'Свойство не принадлежит доске этой задачи' using errcode = '23514';
  end if;

  if p_type = 'select' then
    if new.option_id is null or new.value_text is not null or new.value_date is not null then
      raise exception 'Для списка нужен ровно один выбранный вариант' using errcode = '23514';
    end if;
    select property_id into o_prop from public.property_options where id = new.option_id;
    if o_prop is distinct from new.property_id then
      raise exception 'Вариант не принадлежит этому свойству' using errcode = '23514';
    end if;

  elsif p_type = 'text' then
    if new.value_text is null or btrim(new.value_text) = ''
       or new.value_date is not null or new.option_id is not null then
      raise exception 'Для текстового свойства нужен непустой текст' using errcode = '23514';
    end if;
    if char_length(new.value_text) > 500 then
      raise exception 'Текст свойства не длиннее 500 символов' using errcode = '23514';
    end if;

  elsif p_type = 'url' then
    if new.value_text is null or new.value_date is not null or new.option_id is not null then
      raise exception 'Для ссылки нужен URL' using errcode = '23514';
    end if;
    if new.value_text !~* '^https?://[^\s/$.?#][^\s]*$' then
      raise exception 'Некорректная ссылка: нужен адрес вида https://...' using errcode = '23514';
    end if;

  elsif p_type = 'date' then
    if new.value_date is null or new.value_text is not null or new.option_id is not null then
      raise exception 'Для даты нужна дата' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger task_values_validate before insert or update on public.task_values
  for each row execute function public.validate_task_value();

-- Триггер смены типа создаём здесь, когда task_values уже существует.
create trigger properties_type_guard before update on public.properties
  for each row execute function public.guard_property_type_change();

-- ---------------------------------------------------------------------
-- Представления (общие: owner_id пустой; личные: owner_id = автор)
-- ---------------------------------------------------------------------
create table public.views (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards (id) on delete cascade,
  owner_id   uuid references auth.users (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  config     jsonb not null default '{}'::jsonb check (octet_length(config::text) <= 20000),
  position   text collate "C" not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index views_board_idx on public.views (board_id);

create trigger views_touch before update on public.views
  for each row execute function public.touch_row();

-- =====================================================================
-- RLS
-- Правило: всё доступно только активным участникам (is_active_member()).
-- Без входа (роль anon) таблицы недоступны вообще.
-- =====================================================================
alter table public.boards           enable row level security;
alter table public.board_columns    enable row level security;
alter table public.properties       enable row level security;
alter table public.property_options enable row level security;
alter table public.tasks            enable row level security;
alter table public.task_values      enable row level security;
alter table public.views            enable row level security;

-- boards
create policy boards_select on public.boards for select to authenticated
  using (public.is_active_member());
create policy boards_insert on public.boards for insert to authenticated
  with check (public.is_active_member());
create policy boards_update on public.boards for update to authenticated
  using (public.is_active_member()) with check (public.is_active_member());
-- удалить можно только архивную доску
create policy boards_delete on public.boards for delete to authenticated
  using (public.is_active_member() and archived_at is not null);

-- board_columns
create policy columns_select on public.board_columns for select to authenticated
  using (public.is_active_member());
create policy columns_insert on public.board_columns for insert to authenticated
  with check (public.is_active_member());
create policy columns_update on public.board_columns for update to authenticated
  using (public.is_active_member()) with check (public.is_active_member());
create policy columns_delete on public.board_columns for delete to authenticated
  using (public.is_active_member() and archived_at is not null);

-- properties
create policy properties_select on public.properties for select to authenticated
  using (public.is_active_member());
create policy properties_insert on public.properties for insert to authenticated
  with check (public.is_active_member());
create policy properties_update on public.properties for update to authenticated
  using (public.is_active_member()) with check (public.is_active_member());
create policy properties_delete on public.properties for delete to authenticated
  using (public.is_active_member() and archived_at is not null);

-- property_options (удаление защищено внешним ключом task_values.option_id)
create policy options_select on public.property_options for select to authenticated
  using (public.is_active_member());
create policy options_insert on public.property_options for insert to authenticated
  with check (public.is_active_member());
create policy options_update on public.property_options for update to authenticated
  using (public.is_active_member()) with check (public.is_active_member());
create policy options_delete on public.property_options for delete to authenticated
  using (public.is_active_member());

-- tasks (окончательно удалить можно только из корзины)
create policy tasks_select on public.tasks for select to authenticated
  using (public.is_active_member());
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.is_active_member());
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_active_member()) with check (public.is_active_member());
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_active_member() and deleted_at is not null);

-- task_values
create policy values_select on public.task_values for select to authenticated
  using (public.is_active_member());
create policy values_insert on public.task_values for insert to authenticated
  with check (public.is_active_member());
create policy values_update on public.task_values for update to authenticated
  using (public.is_active_member()) with check (public.is_active_member());
create policy values_delete on public.task_values for delete to authenticated
  using (public.is_active_member());

-- views: общие видят и меняют все, личные — только владелец
create policy views_select on public.views for select to authenticated
  using (public.is_active_member() and (owner_id is null or owner_id = auth.uid()));
create policy views_insert on public.views for insert to authenticated
  with check (public.is_active_member() and (owner_id is null or owner_id = auth.uid()));
create policy views_update on public.views for update to authenticated
  using (public.is_active_member() and (owner_id is null or owner_id = auth.uid()))
  with check (public.is_active_member() and (owner_id is null or owner_id = auth.uid()));
create policy views_delete on public.views for delete to authenticated
  using (public.is_active_member() and (owner_id is null or owner_id = auth.uid()));

-- =====================================================================
-- Права доступа (второй рубеж поверх RLS)
-- anon не получает ничего. У boards закрыт прямой доступ к счётчику
-- next_task_number: им управляет только триггер.
-- =====================================================================
revoke all on public.boards, public.board_columns, public.properties,
              public.property_options, public.tasks, public.task_values,
              public.views
  from anon, authenticated;

grant select, delete on public.boards to authenticated;
grant insert (name, description, position)                    on public.boards to authenticated;
grant update (name, description, position, archived_at)       on public.boards to authenticated;

grant select, insert, update, delete on public.board_columns    to authenticated;
grant select, insert, update, delete on public.properties       to authenticated;
grant select, insert, update, delete on public.property_options to authenticated;
grant select, insert, update, delete on public.tasks            to authenticated;
grant select, insert, update, delete on public.task_values      to authenticated;
grant select, insert, update, delete on public.views            to authenticated;

-- =====================================================================
-- Realtime: изменения этих таблиц будут приходить открытым вкладкам.
-- replica identity full: при удалении/обновлении приходит вся старая строка.
-- =====================================================================
alter table public.boards           replica identity full;
alter table public.board_columns    replica identity full;
alter table public.properties       replica identity full;
alter table public.property_options replica identity full;
alter table public.tasks            replica identity full;
alter table public.task_values      replica identity full;
alter table public.views            replica identity full;

alter publication supabase_realtime add table
  public.boards, public.board_columns, public.properties,
  public.property_options, public.tasks, public.task_values, public.views;
