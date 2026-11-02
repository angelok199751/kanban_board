-- =====================================================================
-- QA Flow · миграция 006 · окончательное удаление колонки
-- =====================================================================
-- Что делает: добавляет функцию delete_column_forever(id). Она удаляет колонку и все её карточки
-- (в том числе архивные и из корзины) одним действием. Колонку нельзя удалить, пока она не в архиве.
-- Возвращает число удалённых карточек.
--
-- Зачем функция: внешний ключ не даёт удалить колонку с карточками, а карточки по правилам удаляются
-- только из корзины. Функция проходит эти шаги по порядку внутри одной транзакции: либо всё, либо ничего.
-- Работает с правами вызывающего (security invoker), поэтому политики RLS действуют как обычно.
--
-- Окончательное удаление свойства отдельной функции не требует: свойство удаляется обычным запросом
-- (политика разрешает только архивное), значения и варианты каскадно удаляются вместе с ним.
--
-- Ничего не удаляет и не меняет в существующих данных. Выполнять после 001-005, один раз.
-- =====================================================================

create or replace function public.delete_column_forever(p_column_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_archived timestamptz;
  v_deleted integer;
begin
  select archived_at into v_archived from public.board_columns where id = p_column_id;
  if not found then
    raise exception 'Колонка не найдена' using errcode = 'P0002';
  end if;
  if v_archived is null then
    raise exception 'Колонку можно удалить насовсем только из архива';
  end if;

  -- карточки колонки: сначала в корзину (так требует правило удаления), затем насовсем
  update public.tasks set deleted_at = coalesce(deleted_at, now()) where column_id = p_column_id;
  delete from public.tasks where column_id = p_column_id;
  get diagnostics v_deleted = row_count;

  delete from public.board_columns where id = p_column_id;
  return v_deleted;
end;
$$;

revoke all on function public.delete_column_forever(uuid) from public, anon;
grant execute on function public.delete_column_forever(uuid) to authenticated;
