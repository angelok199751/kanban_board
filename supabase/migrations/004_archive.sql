-- =====================================================================
-- QA Flow · миграция 004 · архив и корзина: атомарные операции
-- =====================================================================
-- Что делает: добавляет четыре функции, которые меняют сразу несколько
-- строк как одно целое (в одной транзакции):
--   archive_column(id)            колонка и все её активные карточки уходят в архив
--   restore_column(id)            колонка возвращается вместе с карточками, которые ушли с ней
--                                 (карточки, архивированные раньше отдельно, остаются в архиве)
--   restore_task(id)              карточка возвращается из архива; если её колонка в архиве,
--                                 колонка возвращается тоже (иначе карточку не было бы видно)
--   restore_task_from_trash(id)   карточка возвращается из корзины; если её колонка в архиве,
--                                 карточка попадает в архив (а не пропадает невидимой)
--
-- Что НЕ делает: ничего не удаляет и не меняет существующие данные.
-- Функции работают с правами вызывающего (security invoker), поэтому политики RLS
-- действуют так же, как при обычных запросах. Выполнять после 001-003, один раз.
-- =====================================================================

create or replace function public.archive_column(p_column_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ts timestamptz := now();
  v_found uuid;
begin
  update public.board_columns
     set archived_at = v_ts
   where id = p_column_id and archived_at is null
   returning id into v_found;

  if v_found is null then
    raise exception 'Колонка не найдена или уже в архиве' using errcode = 'P0002';
  end if;

  -- та же отметка времени у карточек: по ней потом узнаем, какие ушли вместе с колонкой
  update public.tasks
     set archived_at = v_ts
   where column_id = p_column_id and archived_at is null and deleted_at is null;
end;
$$;

create or replace function public.restore_column(p_column_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ts timestamptz;
begin
  select archived_at into v_ts from public.board_columns where id = p_column_id;
  if v_ts is null then
    raise exception 'Колонка не найдена или не в архиве' using errcode = 'P0002';
  end if;

  update public.board_columns set archived_at = null where id = p_column_id;

  update public.tasks
     set archived_at = null
   where column_id = p_column_id and archived_at = v_ts and deleted_at is null;
end;
$$;

create or replace function public.restore_task(p_task_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_col uuid;
begin
  update public.tasks
     set archived_at = null
   where id = p_task_id and deleted_at is null and archived_at is not null
   returning column_id into v_col;

  if v_col is null then
    raise exception 'Карточка не найдена, удалена или не в архиве' using errcode = 'P0002';
  end if;

  update public.board_columns set archived_at = null where id = v_col and archived_at is not null;
end;
$$;

create or replace function public.restore_task_from_trash(p_task_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_col uuid;
  v_col_archived timestamptz;
begin
  update public.tasks
     set deleted_at = null
   where id = p_task_id and deleted_at is not null
   returning column_id into v_col;

  if v_col is null then
    raise exception 'Карточка не найдена или не в корзине' using errcode = 'P0002';
  end if;

  select archived_at into v_col_archived from public.board_columns where id = v_col;
  if v_col_archived is not null then
    update public.tasks set archived_at = coalesce(archived_at, now()) where id = p_task_id;
  end if;
end;
$$;

revoke all on function public.archive_column(uuid)           from public, anon;
revoke all on function public.restore_column(uuid)           from public, anon;
revoke all on function public.restore_task(uuid)             from public, anon;
revoke all on function public.restore_task_from_trash(uuid)  from public, anon;
grant execute on function public.archive_column(uuid)          to authenticated;
grant execute on function public.restore_column(uuid)          to authenticated;
grant execute on function public.restore_task(uuid)            to authenticated;
grant execute on function public.restore_task_from_trash(uuid) to authenticated;
