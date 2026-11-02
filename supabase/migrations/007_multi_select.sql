-- =====================================================================
-- QA Flow · миграция 007 · несколько значений у свойства-списка
-- =====================================================================
-- Что делает:
--   * добавляет признак properties.multiple (по умолчанию false — поведение не меняется);
--   * добавляет task_values.option_ids для выбранных вариантов;
--   * обновляет проверку значений: одиночный список хранит option_id,
--     множественный — option_ids (option_id при этом пустой);
--   * добавляет функции удаления варианта и переключения режима свойства.
--
-- Старые значения не переписываются: у существующих списков остаётся option_id,
-- а multiple = false. Клиент читает оба вида, поэтому данные не теряются.
-- Выполнять после 001-006, один раз.
-- =====================================================================

alter table public.properties
  add column if not exists multiple boolean not null default false;

alter table public.task_values
  add column if not exists option_ids uuid[] not null default '{}';

-- Поиск карточек по выбранным вариантам без полного перебора строк.
create index if not exists task_values_option_ids_idx
  on public.task_values using gin (option_ids);

-- ---------------------------------------------------------------------
-- Проверка значения: для списка теперь два допустимых вида.
-- ---------------------------------------------------------------------
create or replace function public.validate_task_value()
returns trigger
language plpgsql
as $$
declare
  t_board    uuid;
  p_board    uuid;
  p_type     text;
  p_multiple boolean;
  o_prop     uuid;
  v_count    integer;
begin
  select board_id into t_board from public.tasks where id = new.task_id;
  select board_id, type, multiple into p_board, p_type, p_multiple
    from public.properties where id = new.property_id;

  if t_board is null or p_board is null or t_board <> p_board then
    raise exception 'Свойство не принадлежит доске этой задачи' using errcode = '23514';
  end if;

  if p_type = 'select' then
    if new.value_text is not null or new.value_date is not null then
      raise exception 'Для списка нужны только выбранные варианты' using errcode = '23514';
    end if;

    if p_multiple then
      if new.option_id is not null
         or new.option_ids is null
         or cardinality(new.option_ids) = 0 then
        raise exception 'Для списка с несколькими значениями нужен хотя бы один вариант' using errcode = '23514';
      end if;

      if cardinality(new.option_ids) <> (select count(distinct x) from unnest(new.option_ids) x) then
        raise exception 'Варианты списка не должны повторяться' using errcode = '23514';
      end if;

      select count(*) into v_count
        from public.property_options
       where property_id = new.property_id and id = any (new.option_ids);
      if v_count <> cardinality(new.option_ids) then
        raise exception 'Вариант не принадлежит этому свойству' using errcode = '23514';
      end if;
    else
      if new.option_id is null or coalesce(cardinality(new.option_ids), 0) <> 0 then
        raise exception 'Для списка нужен ровно один выбранный вариант' using errcode = '23514';
      end if;
      select property_id into o_prop from public.property_options where id = new.option_id;
      if o_prop is distinct from new.property_id then
        raise exception 'Вариант не принадлежит этому свойству' using errcode = '23514';
      end if;
    end if;

  elsif p_type = 'text' then
    if new.value_text is null or btrim(new.value_text) = ''
       or new.value_date is not null or new.option_id is not null
       or coalesce(cardinality(new.option_ids), 0) <> 0 then
      raise exception 'Для текстового свойства нужен непустой текст' using errcode = '23514';
    end if;
    if char_length(new.value_text) > 500 then
      raise exception 'Текст свойства не длиннее 500 символов' using errcode = '23514';
    end if;

  elsif p_type = 'url' then
    if new.value_text is null or new.value_date is not null or new.option_id is not null
       or coalesce(cardinality(new.option_ids), 0) <> 0 then
      raise exception 'Для ссылки нужен URL' using errcode = '23514';
    end if;
    if new.value_text !~* '^https?://[^\s/$.?#][^\s]*$' then
      raise exception 'Некорректная ссылка: нужен адрес вида https://...' using errcode = '23514';
    end if;

  elsif p_type = 'date' then
    if new.value_date is null or new.value_text is not null or new.option_id is not null
       or coalesce(cardinality(new.option_ids), 0) <> 0 then
      raise exception 'Для даты нужна дата' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Удаление варианта: убирает его из одиночных и множественных значений.
-- Строки, где он был единственным, удаляются: пустое значение = нет строки.
-- ---------------------------------------------------------------------
create or replace function public.clear_option_values(p_option_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
begin
  select property_id into v_property from public.property_options where id = p_option_id;
  if v_property is null then
    return;
  end if;

  delete from public.task_values
   where option_id = p_option_id;

  -- множество состояло только из удаляемого варианта — значение становится пустым
  delete from public.task_values
   where property_id = v_property
     and option_id is null
     and value_text is null
     and value_date is null
     and option_ids = array[p_option_id];

  update public.task_values
     set option_ids = array_remove(option_ids, p_option_id)
   where property_id = v_property
     and p_option_id = any (option_ids);
end;
$$;

-- ---------------------------------------------------------------------
-- Переключение режима свойства. При включении существующие одиночные
-- значения переезжают в массив, при выключении остаётся первый вариант.
-- ---------------------------------------------------------------------
create or replace function public.set_property_multiple(p_property_id uuid, p_multiple boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_type text;
begin
  select type into v_type from public.properties where id = p_property_id;
  if v_type is null then
    raise exception 'Свойство не найдено' using errcode = 'P0002';
  end if;
  if v_type <> 'select' then
    raise exception 'Несколько значений бывает только у свойства-списка' using errcode = '23514';
  end if;

  update public.properties set multiple = p_multiple where id = p_property_id;

  if p_multiple then
    update public.task_values
       set option_ids = array[option_id], option_id = null
     where property_id = p_property_id and option_id is not null;
  else
    update public.task_values
       set option_id = option_ids[1], option_ids = '{}'
     where property_id = p_property_id and option_id is null and cardinality(option_ids) > 0;
  end if;
end;
$$;

revoke all on function public.clear_option_values(uuid) from public, anon;
revoke all on function public.set_property_multiple(uuid, boolean) from public, anon;
grant execute on function public.clear_option_values(uuid) to authenticated;
grant execute on function public.set_property_multiple(uuid, boolean) to authenticated;
