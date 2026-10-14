-- QA Flow: триггеры и функции (этап 1).

-- ---------------------------------------------------------------------------
-- Доступ: «участник» — активный профиль. Используется в политиках RLS.
-- ---------------------------------------------------------------------------
create or replace function public.is_member()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active);
$$;

-- Профиль создаётся только для технических адресов вида <ник>@qaflow.local.
-- Любой другой пользователь Auth доступа к данным не получает.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_nick text;
begin
  if lower(new.email) not like '%@qaflow.local' then
    return new;
  end if;
  v_nick := lower(split_part(new.email, '@', 1));
  insert into public.profiles (id, nickname, display_name)
  values (new.id, v_nick, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), v_nick))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Задачи: номер, версия, служебные поля
-- ---------------------------------------------------------------------------
create or replace function public.tg_task_before_write()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  n int;
  v_board uuid;
begin
  -- столбец должен принадлежать той же доске
  select board_id into v_board from public.board_columns where id = new.column_id;
  if v_board is null or v_board <> new.board_id then
    raise exception 'Столбец не принадлежит этой доске' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.number is null then
      update public.boards set next_number = next_number + 1
       where id = new.board_id
       returning next_number - 1 into n;
      if n is null then
        raise exception 'Доска не найдена' using errcode = '23503';
      end if;
      new.number := n;
    else
      update public.boards set next_number = greatest(next_number, new.number + 1)
       where id = new.board_id;
    end if;
    if new.archived_at is not null then new.archived_by := coalesce(new.archived_by, auth.uid()); end if;
    if new.deleted_at  is not null then new.deleted_by  := coalesce(new.deleted_by,  auth.uid()); end if;
    return new;
  end if;

  -- UPDATE
  if new.board_id <> old.board_id then
    raise exception 'Задачу нельзя перенести на другую доску' using errcode = '23514';
  end if;
  new.number     := old.number;                 -- номер не меняется
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.version    := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();

  if new.archived_at is distinct from old.archived_at then
    new.archived_by := case when new.archived_at is null then null else auth.uid() end;
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    new.deleted_by := case when new.deleted_at is null then null else auth.uid() end;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write
  before insert or update on public.tasks
  for each row execute function public.tg_task_before_write();

-- ---------------------------------------------------------------------------
-- Статьи: версия и служебные поля
-- ---------------------------------------------------------------------------
create or replace function public.tg_article_before_update()
returns trigger
language plpgsql
as $$
begin
  new.base_id    := old.base_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.version    := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists articles_before_update on public.knowledge_articles;
create trigger articles_before_update
  before update on public.knowledge_articles
  for each row execute function public.tg_article_before_update();

-- ---------------------------------------------------------------------------
-- Новая доска: встроенные свойства, стандартные столбцы, общее представление
-- ---------------------------------------------------------------------------
create or replace function public.tg_board_bootstrap()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.board_properties (board_id, key, title, type, builtin, position) values
    (new.id, 'номер',         'Номер',         'number',   true, 1),
    (new.id, 'задача',        'Задача',        'title',    true, 2),
    (new.id, 'статус',        'Статус',        'status',   true, 3),
    (new.id, 'исполнитель',   'Исполнитель',   'select',   true, 4),
    (new.id, 'разраб',        'Разраб',        'select',   true, 5),
    (new.id, 'дата выкатки',  'Дата выкатки',  'date',     true, 6),
    (new.id, 'категория',     'Категория',     'select',   true, 7),
    (new.id, 'флоу',          'Флоу',          'select',   true, 8),
    (new.id, 'версия',        'Версия',        'text',     true, 9),
    (new.id, 'коммент',       'Коммент',       'longtext', true, 10)
  on conflict (board_id, key) do nothing;

  -- Стандартные статусы (написание — как на рабочем листе «143 релиз»).
  -- Статус «Архив» столбцом не является: архив — отдельный раздел.
  insert into public.board_columns (board_id, name, color, position) values
    (new.id, 'Не залито',                          'gray',   1),
    (new.id, 'Залито',                             'blue',   2),
    (new.id, 'Без теста',                          'orange', 3),
    (new.id, 'В работе',                           'yellow', 4),
    (new.id, 'Ждем правки',                        'purple', 5),
    (new.id, 'Ждем уточнения',                     'purple', 6),
    (new.id, 'На доработке',                       'red',    7),
    (new.id, 'Залиты правки',                      'blue',   8),
    (new.id, 'Готово',                             'green',  9),
    (new.id, 'Откатили',                           'red',    10),
    (new.id, 'Не берем в релиз',                   'gray',   11),
    (new.id, 'Реализовано в рамках другой задачи', 'gray',   12),
    (new.id, 'Уже на проде',                       'green',  13),
    (new.id, 'Дубликат',                           'gray',   14)
  on conflict (board_id, name) do nothing;

  insert into public.board_views (board_id, owner_id, name, position, is_default, config)
  values (new.id, null, 'Все задачи', 0, true, '{}'::jsonb)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists boards_bootstrap on public.boards;
create trigger boards_bootstrap
  after insert on public.boards
  for each row execute function public.tg_board_bootstrap();

-- Общее представление удалить нельзя.
create or replace function public.tg_view_protect()
returns trigger
language plpgsql
as $$
begin
  if old.is_default and exists (select 1 from public.boards b where b.id = old.board_id) then
    raise exception 'Основное представление удалить нельзя' using errcode = '23514';
  end if;
  return old;
end;
$$;

drop trigger if exists board_views_protect on public.board_views;
create trigger board_views_protect
  before delete on public.board_views
  for each row execute function public.tg_view_protect();

-- Свойство-основа (номер, задача, статус) нельзя удалить или сменить его тип.
create or replace function public.tg_property_protect()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.builtin and exists (select 1 from public.boards b where b.id = old.board_id) then
      raise exception 'Встроенное свойство удалить нельзя — его можно скрыть' using errcode = '23514';
    end if;
    return old;
  end if;
  if old.builtin and (new.type <> old.type or new.key <> old.key) then
    raise exception 'У встроенного свойства нельзя менять тип и ключ' using errcode = '23514';
  end if;
  new.key := old.key;
  if old.key in ('номер','задача') and new.hidden then
    raise exception 'Свойство «%» нельзя скрыть', old.title using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists board_properties_protect on public.board_properties;
create trigger board_properties_protect
  before update or delete on public.board_properties
  for each row execute function public.tg_property_protect();

-- ---------------------------------------------------------------------------
-- Операции, которые должны быть одним запросом
-- ---------------------------------------------------------------------------

-- Порядок столбцов: один вызов вместо N запросов. Передайте ВСЕ id активных столбцов доски.
create or replace function public.reorder_columns(p_board uuid, p_ids uuid[])
returns void
language plpgsql
as $$
declare
  n int;
begin
  select count(*) into n from public.board_columns
   where board_id = p_board and archived_at is null;
  if n <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'Список столбцов устарел: обнови доску' using errcode = '40001';
  end if;

  update public.board_columns c
     set position = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where c.id = o.id and c.board_id = p_board and c.archived_at is null;
end;
$$;

-- Архив всего столбца: столбец скрывается, все его активные карточки уходят в архив.
create or replace function public.archive_column(p_column uuid)
returns int
language plpgsql
as $$
declare
  ts timestamptz := now();
  n  int;
begin
  update public.board_columns set archived_at = ts
   where id = p_column and archived_at is null;
  if not found then
    raise exception 'Столбец не найден или уже в архиве' using errcode = 'P0002';
  end if;

  update public.tasks set archived_at = ts
   where column_id = p_column and archived_at is null and deleted_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Возврат столбца: возвращаются только карточки, ушедшие в архив вместе с ним.
create or replace function public.restore_column(p_column uuid)
returns int
language plpgsql
as $$
declare
  ts timestamptz;
  n  int;
begin
  select archived_at into ts from public.board_columns where id = p_column;
  if ts is null then
    raise exception 'Столбец не в архиве' using errcode = 'P0002';
  end if;

  update public.tasks set archived_at = null
   where column_id = p_column and archived_at = ts and deleted_at is null;
  get diagnostics n = row_count;

  update public.board_columns set archived_at = null where id = p_column;
  return n;
end;
$$;

-- Возврат одной карточки на доску; если её столбец был в архиве — он возвращается тоже.
create or replace function public.restore_task(p_task uuid)
returns void
language plpgsql
as $$
declare
  v_col uuid;
begin
  update public.tasks set archived_at = null
   where id = p_task and archived_at is not null
   returning column_id into v_col;
  if v_col is null then
    raise exception 'Задача не найдена или не в архиве' using errcode = 'P0002';
  end if;
  update public.board_columns set archived_at = null where id = v_col and archived_at is not null;
end;
$$;
