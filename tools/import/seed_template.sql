-- QA Flow: импорт данных из Google Sheets. Создано tools/import/build_seed.py.
-- Выполнить целиком в Supabase → SQL Editor ПОСЛЕ миграций 0001–0003.
-- Повторный запуск безопасен: дубликаты не создаются, существующие записи не перезаписываются.
-- Результат — последняя строка внизу (отчёт); он же сохраняется в таблице import_reports.

do $seed$
declare
  d          jsonb := $qaflow_json$__PAYLOAD__$qaflow_json$::jsonb;
  v_over     boolean := coalesce((d ->> 'overwrite')::boolean, false);
  v_board    uuid;
  v_new      boolean := false;
  v_kb       uuid;
  v_kb_new   boolean := false;
  r          jsonb;
  o          jsonb;
  k          text;
  v_prop     uuid;
  v_col      uuid;
  v_pos      int;
  n_ins      int := 0;
  n_skip     int := 0;
  n_art_ins  int := 0;
  n_art_skip int := 0;
  n_opt      int := 0;
  n_col      int := 0;
  n_prop     int := 0;
  c          int;
  v_tasks_db int;
  v_art_db   int;
  v_arch_db  int;
  v_report   jsonb;
begin
  -- ---------------------------------------------------------------- доска
  insert into public.boards (name, legacy_key)
  values (d #>> '{board,name}', d #>> '{board,legacy_key}')
  on conflict (legacy_key) do nothing
  returning id into v_board;

  if v_board is null then
    select id into v_board from public.boards where legacy_key = d #>> '{board,legacy_key}';
  else
    v_new := true;   -- триггер уже создал встроенные свойства, столбцы и общее представление
  end if;

  -- ---------------------------------------------------------------- свойства
  for r in select * from jsonb_array_elements(d -> 'properties') loop
    if exists (select 1 from public.board_properties where board_id = v_board and key = r ->> 'key') then
      -- встроенное свойство: на новой доске берём названия из заголовков листа
      update public.board_properties
         set legacy_header = r ->> 'legacy_header',
             title = case when v_new or v_over then r ->> 'title' else title end,
             position = case when v_new or v_over then (r ->> 'position')::int else position end
       where board_id = v_board and key = r ->> 'key';
    else
      insert into public.board_properties (board_id, key, title, type, builtin, position, legacy_header)
      values (v_board, r ->> 'key', r ->> 'title', r ->> 'type', false, (r ->> 'position')::int, r ->> 'legacy_header');
      n_prop := n_prop + 1;
    end if;
  end loop;

  -- ---------------------------------------------------------------- значения списков и цвета
  for k, o in select * from jsonb_each(d -> 'options') loop
    select id into v_prop from public.board_properties where board_id = v_board and key = k;
    for r in select * from jsonb_array_elements(o) loop
      insert into public.property_options (property_id, value, color, position)
      values (v_prop, r ->> 'value', r ->> 'color', (r ->> 'position')::int)
      on conflict (property_id, value) do nothing;
      get diagnostics c = row_count;
      n_opt := n_opt + c;
    end loop;
  end loop;

  -- ---------------------------------------------------------------- столбцы (статусы)
  select coalesce(max(position), 0) into v_pos from public.board_columns where board_id = v_board;
  for r in select * from jsonb_array_elements(d -> 'columns') loop
    insert into public.board_columns (board_id, name, position)
    values (v_board, r ->> 'name', v_pos + 1)
    on conflict (board_id, name) do nothing;
    get diagnostics c = row_count;
    if c > 0 then v_pos := v_pos + 1; n_col := n_col + 1; end if;
  end loop;

  -- ---------------------------------------------------------------- задачи
  for r in select * from jsonb_array_elements(d -> 'tasks') loop
    select id into v_col from public.board_columns where board_id = v_board and name = r ->> 'status';
    if v_col is null then
      raise exception 'Не найден столбец для статуса «%»', r ->> 'status';
    end if;

    insert into public.tasks (board_id, number, title, column_id, position, description, props, legacy_id, archived_at)
    values (v_board, (r ->> 'number')::int, r ->> 'title', v_col, r ->> 'position',
            coalesce(r ->> 'description', ''), coalesce(r -> 'props', '{}'::jsonb), r ->> 'legacy_id',
            case when (r ->> 'archived')::boolean then now() end)
    on conflict (legacy_id) do update
      set title = excluded.title, column_id = excluded.column_id, description = excluded.description,
          props = excluded.props
      where v_over;
    get diagnostics c = row_count;
    if c > 0 then n_ins := n_ins + 1; else n_skip := n_skip + 1; end if;
  end loop;

  -- ---------------------------------------------------------------- база знаний
  insert into public.knowledge_bases (name, legacy_key)
  values (d #>> '{knowledge,name}', d #>> '{knowledge,legacy_key}')
  on conflict (legacy_key) do nothing
  returning id into v_kb;
  if v_kb is null then
    select id into v_kb from public.knowledge_bases where legacy_key = d #>> '{knowledge,legacy_key}';
  else
    v_kb_new := true;
  end if;

  for r in select * from jsonb_array_elements(d #> '{knowledge,articles}') loop
    insert into public.knowledge_articles (base_id, title, content, labels, legacy_id, created_at, updated_at)
    values (v_kb, r ->> 'title', coalesce(r ->> 'content', ''), coalesce(r ->> 'labels', ''), r ->> 'legacy_id',
            coalesce((r ->> 'updated_at')::timestamptz, now()), coalesce((r ->> 'updated_at')::timestamptz, now()))
    on conflict (legacy_id) do nothing;
    get diagnostics c = row_count;
    if c > 0 then n_art_ins := n_art_ins + 1; else n_art_skip := n_art_skip + 1; end if;
  end loop;

  -- ---------------------------------------------------------------- проверка и отчёт
  select count(*) into v_tasks_db from public.tasks where board_id = v_board and legacy_id is not null;
  select count(*) into v_arch_db  from public.tasks where board_id = v_board and legacy_id is not null and archived_at is not null;
  select count(*) into v_art_db   from public.knowledge_articles where base_id = v_kb and legacy_id is not null;

  v_report := jsonb_build_object(
    'ok', (v_tasks_db >= (d #>> '{source,tasks}')::int and v_art_db >= (d #>> '{source,articles}')::int),
    'board_created', v_new,
    'knowledge_base_created', v_kb_new,
    'tasks',    jsonb_build_object('in_file', (d #>> '{source,tasks}')::int, 'inserted_now', n_ins,
                                   'already_existed', n_skip, 'in_database', v_tasks_db, 'archived', v_arch_db),
    'articles', jsonb_build_object('in_file', (d #>> '{source,articles}')::int, 'inserted_now', n_art_ins,
                                   'already_existed', n_art_skip, 'in_database', v_art_db),
    'new_custom_properties', n_prop,
    'new_options', n_opt,
    'new_columns', n_col,
    'overwrite', v_over,
    'warnings', d -> 'warnings'
  );
  insert into public.import_reports (report) values (v_report);
end
$seed$;

-- Отчёт об импорте:
select jsonb_pretty(report) as "Отчёт об импорте"
  from public.import_reports order by created_at desc limit 1;
