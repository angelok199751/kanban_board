-- Тесты схемы, триггеров и RLS для миграций 001 и 002.
--
-- Запуск (локальный PostgreSQL 14+; подробности в tools/test/README.md):
--   psql -v ON_ERROR_STOP=1 -d qaflow_test -f tools/test/10_tests.sql
-- после 00_mock_supabase.sql и обеих миграций.
--
-- Все данные вымышленные. Каждый блок, кроме T1, откатывается (rollback).
-- При провале psql останавливается с сообщением «ТЕСТ ПРОВАЛЕН» или ошибкой assert.
-- Ожидаемая ошибка проверяется по конкретному коду SQLSTATE: посторонняя ошибка
-- (опечатка, не тот запрет) тест не пройдёт, а провалит.

\set ON_ERROR_STOP on

\set anna  '00000000-0000-0000-0000-0000000000a1'
\set bob   '00000000-0000-0000-0000-0000000000b2'
\set carol '00000000-0000-0000-0000-0000000000c3'

-- ===========================================================================
-- T1. Участники создаются триггером; первый пользователь становится admin
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data, created_at) values
  (:'anna',  'anna@qaflow.test',  '{"display_name":"Анна"}', now() - interval '2 day'),
  (:'bob',   'bob@qaflow.test',   '{}',                      now() - interval '1 day'),
  (:'carol', 'carol@qaflow.test', '{}',                      now());

do $$ begin
  assert (select count(*) from public.members) = 3, 'T1: ожидалось 3 участника';
  assert (select role from public.members where user_id = '00000000-0000-0000-0000-0000000000a1') = 'admin',
         'T1: первый пользователь должен стать admin';
  assert (select role from public.members where user_id = '00000000-0000-0000-0000-0000000000b2') = 'member',
         'T1: второй пользователь должен быть member';
  assert (select display_name from public.members where user_id = '00000000-0000-0000-0000-0000000000a1') = 'Анна',
         'T1: имя берётся из display_name';
  assert (select display_name from public.members where user_id = '00000000-0000-0000-0000-0000000000b2') = 'bob',
         'T1: без display_name имя берётся из адреса до @';
end $$;

-- carol деактивируем (как будто её отключили); дальше она «вошедшая, но не участник»
update public.members set is_active = false where user_id = :'carol';
\echo T1 ok: участники создаются триггером, первый — admin

-- ===========================================================================
-- T2. Аноним не получает ничего
-- ===========================================================================
begin;
set local role anon;
do $$ begin
  begin perform count(*) from public.members;  raise exception 'ТЕСТ ПРОВАЛЕН: аноним прочитал members';
  exception when sqlstate '42501' then null; end;
  begin perform count(*) from public.boards;   raise exception 'ТЕСТ ПРОВАЛЕН: аноним прочитал boards';
  exception when sqlstate '42501' then null; end;
  begin perform count(*) from public.tasks;    raise exception 'ТЕСТ ПРОВАЛЕН: аноним прочитал tasks';
  exception when sqlstate '42501' then null; end;
  begin perform count(*) from public.views;    raise exception 'ТЕСТ ПРОВАЛЕН: аноним прочитал views';
  exception when sqlstate '42501' then null; end;
  begin insert into public.boards (name, position) values ('взлом', 'a0'); raise exception 'ТЕСТ ПРОВАЛЕН: аноним создал доску';
  exception when sqlstate '42501' then null; end;
end $$;
rollback;
\echo T2 ok: аноним не читает и не пишет

-- ===========================================================================
-- T3. Деактивированный участник (carol) ничего не видит и не может писать
-- ===========================================================================
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bob', true);
insert into public.boards (name, position) values ('Доска Боба', 'a0');

select set_config('request.jwt.claim.sub', :'carol', true);
do $$ begin
  assert (select count(*) from public.boards)  = 0, 'T3: деактивированный видит доски';
  assert (select count(*) from public.members) = 0, 'T3: деактивированный видит участников';
  begin
    insert into public.boards (name, position) values ('взлом', 'a1');
    raise exception 'ТЕСТ ПРОВАЛЕН: деактивированный создал доску';
  exception when sqlstate '42501' then null; end;
end $$;
rollback;
\echo T3 ok: деактивированный участник данных не видит и не пишет

-- ===========================================================================
-- T4. Доска, колонки, задачи: номера, версии, составной внешний ключ
-- ===========================================================================
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bob', true);
do $$
declare
  b1 uuid; b2 uuid; c1 uuid; c2 uuid; cx uuid;
  t1 uuid; t2 uuid; n int; v int;
begin
  insert into public.boards (name, position) values ('Доска 1', 'a0') returning id into b1;
  insert into public.boards (name, position) values ('Доска 2', 'a1') returning id into b2;
  insert into public.board_columns (board_id, name, position) values (b1, 'Новые', 'a0') returning id into c1;
  insert into public.board_columns (board_id, name, position) values (b1, 'В работе', 'a1') returning id into c2;
  insert into public.board_columns (board_id, name, position) values (b2, 'Чужая', 'a0') returning id into cx;

  -- номера назначаются автоматически и подряд внутри доски
  insert into public.tasks (board_id, column_id, title, position) values (b1, c1, 'Первая', 'a0')  returning id, number, version into t1, n, v;
  assert n = 1 and v = 1, 'T4: первая задача должна получить номер 1, версия 1';
  insert into public.tasks (board_id, column_id, title, position) values (b1, c1, 'Вторая', 'a1')  returning id, number into t2, n;
  assert n = 2, 'T4: вторая задача должна получить номер 2';
  insert into public.tasks (board_id, column_id, title, position) values (b2, cx, 'Другая доска', 'a0') returning number into n;
  assert n = 1, 'T4: нумерация на второй доске начинается с 1';

  -- счётчик номеров напрямую менять нельзя (нет права на столбец)
  begin
    update public.boards set next_task_number = 100 where id = b1;
    raise exception 'ТЕСТ ПРОВАЛЕН: удалось изменить next_task_number';
  exception when sqlstate '42501' then null; end;

  -- колонка другой доски недопустима
  begin
    insert into public.tasks (board_id, column_id, title, position) values (b1, cx, 'Не туда', 'a2');
    raise exception 'ТЕСТ ПРОВАЛЕН: задача принята с колонкой чужой доски';
  exception when sqlstate '23503' then null; end;

  -- оптимистичная блокировка: сохранение с актуальной версией проходит, с устаревшей — нет
  update public.tasks set title = 'Первая (правка)' where id = t1 and version = 1;
  get diagnostics n = row_count;
  assert n = 1, 'T4: правка с актуальной версией должна пройти';
  assert (select version from public.tasks where id = t1) = 2, 'T4: версия должна вырасти до 2';
  update public.tasks set title = 'Затирание' where id = t1 and version = 1;
  get diagnostics n = row_count;
  assert n = 0, 'T4: правка с устаревшей версией не должна затирать';
  assert (select title from public.tasks where id = t1) = 'Первая (правка)', 'T4: чужая правка потеряна';

  -- неизменяемые поля защищены триггером
  update public.tasks set number = 99 where id = t1;
  assert (select number from public.tasks where id = t1) = 1, 'T4: номер задачи изменился';

  -- перенос карточки между колонками
  update public.tasks set column_id = c2, position = 'a0' where id = t2;
  assert (select column_id from public.tasks where id = t2) = c2, 'T4: перенос карточки не сработал';
end $$;
rollback;
\echo T4 ok: номера, версии, защита от чужой колонки и счётчика

-- ===========================================================================
-- T5. Защита от случайной потери данных: архив → удаление, корзина
-- ===========================================================================
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bob', true);
do $$
declare
  b uuid; c uuid; t uuid; n int;
begin
  insert into public.boards (name, position) values ('Доска', 'a0') returning id into b;
  insert into public.board_columns (board_id, name, position) values (b, 'Колонка', 'a0') returning id into c;
  insert into public.tasks (board_id, column_id, title, position) values (b, c, 'Задача', 'a0') returning id into t;

  -- задачу нельзя удалить насовсем, пока она не в корзине
  delete from public.tasks where id = t;
  get diagnostics n = row_count;
  assert n = 0, 'T5: задача удалена минуя корзину';

  -- колонку нельзя удалить насовсем без архивации
  delete from public.board_columns where id = c;
  get diagnostics n = row_count;
  assert n = 0, 'T5: колонка удалена без архивации';

  -- архивная колонка с задачами всё равно не удаляется (внешний ключ)
  update public.board_columns set archived_at = now() where id = c;
  begin
    delete from public.board_columns where id = c;
    raise exception 'ТЕСТ ПРОВАЛЕН: удалена колонка с задачами';
  exception when sqlstate '23503' then null; end;

  -- доску нельзя удалить без архивации
  delete from public.boards where id = b;
  get diagnostics n = row_count;
  assert n = 0, 'T5: доска удалена без архивации';

  -- корзина: мягкое удаление, затем окончательное
  update public.tasks set deleted_at = now() where id = t;
  delete from public.tasks where id = t;
  get diagnostics n = row_count;
  assert n = 1, 'T5: задачу из корзины должно быть можно удалить';

  -- теперь колонка пуста и архивна — удаляется; доска после архивации тоже
  delete from public.board_columns where id = c;
  get diagnostics n = row_count;
  assert n = 1, 'T5: пустую архивную колонку должно быть можно удалить';
  update public.boards set archived_at = now() where id = b;
  delete from public.boards where id = b;
  get diagnostics n = row_count;
  assert n = 1, 'T5: архивную доску должно быть можно удалить';
end $$;
rollback;
\echo T5 ok: удаление только через архив и корзину

-- ===========================================================================
-- T6. Свойства: типы, проверки значений, защита от потери значений
-- ===========================================================================
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bob', true);
set local timezone = 'Pacific/Kiritimati';   -- UTC+14: проверка, что дата не «едет»
do $$
declare
  b uuid; b2 uuid; c uuid; t uuid;
  p_sel uuid; p_sel2 uuid; p_txt uuid; p_url uuid; p_date uuid; p_b2 uuid;
  o1 uuid; o_foreign uuid; n int;
begin
  insert into public.boards (name, position) values ('Доска', 'a0') returning id into b;
  insert into public.boards (name, position) values ('Другая', 'a1') returning id into b2;
  insert into public.board_columns (board_id, name, position) values (b, 'Колонка', 'a0') returning id into c;
  insert into public.tasks (board_id, column_id, title, position) values (b, c, 'Задача', 'a0') returning id into t;

  insert into public.properties (board_id, name, type, position) values (b,  'Assignee',   'select', 'a0') returning id into p_sel;
  insert into public.properties (board_id, name, type, position) values (b,  'Note',       'text',   'a1') returning id into p_txt;
  insert into public.properties (board_id, name, type, position) values (b,  'Link',       'url',    'a2') returning id into p_url;
  insert into public.properties (board_id, name, type, position) values (b,  'Due',        'date',   'a3') returning id into p_date;
  insert into public.properties (board_id, name, type, position) values (b,  'Second list','select', 'a4') returning id into p_sel2;
  insert into public.properties (board_id, name, type, position) values (b2, 'Foreign',    'text',   'a0') returning id into p_b2;

  -- допустимы только 4 типа
  begin
    insert into public.properties (board_id, name, type, position) values (b, 'Count', 'number', 'a5');
    raise exception 'ТЕСТ ПРОВАЛЕН: принят тип number';
  exception when sqlstate '23514' then null; end;

  -- имя активного свойства уникально в пределах доски (без учёта регистра)
  begin
    insert into public.properties (board_id, name, type, position) values (b, 'assignee', 'text', 'a6');
    raise exception 'ТЕСТ ПРОВАЛЕН: принято дублирующее имя свойства';
  exception when sqlstate '23505' then null; end;

  -- варианты бывают только у списка
  begin
    insert into public.property_options (property_id, label, position) values (p_txt, 'X', 'a0');
    raise exception 'ТЕСТ ПРОВАЛЕН: вариант добавлен к текстовому свойству';
  exception when sqlstate '23514' then null; end;

  insert into public.property_options (property_id, label, position) values (p_sel,  'Анна',  'a0') returning id into o1;
  insert into public.property_options (property_id, label, position) values (p_sel2, 'Чужой вариант', 'a0') returning id into o_foreign;

  -- допустимые значения всех четырёх типов
  insert into public.task_values (task_id, property_id, option_id)  values (t, p_sel,  o1);
  insert into public.task_values (task_id, property_id, value_text) values (t, p_txt,  'Короткая заметка');
  insert into public.task_values (task_id, property_id, value_text) values (t, p_url,  'https://example.com/a?b=1');
  insert into public.task_values (task_id, property_id, value_date) values (t, p_date, date '2026-03-01');
  assert (select value_date::text from public.task_values where task_id = t and property_id = p_date) = '2026-03-01',
         'T6: дата сдвинулась';

  -- недопустимые значения (проверка срабатывает до уникальности, поэтому значения можно не удалять)
  begin
    insert into public.task_values (task_id, property_id, option_id) values (t, p_sel, o_foreign);
    raise exception 'ТЕСТ ПРОВАЛЕН: принят вариант другого свойства';
  exception when sqlstate '23514' then null; end;
  begin
    insert into public.task_values (task_id, property_id, value_text) values (t, p_sel, 'текстом нельзя');
    raise exception 'ТЕСТ ПРОВАЛЕН: в список записан текст';
  exception when sqlstate '23514' then null; end;
  begin
    insert into public.task_values (task_id, property_id, value_text) values (t, p_url, 'javascript:alert(1)');
    raise exception 'ТЕСТ ПРОВАЛЕН: принята небезопасная ссылка';
  exception when sqlstate '23514' then null; end;
  begin
    insert into public.task_values (task_id, property_id, value_text) values (t, p_url, 'просто текст');
    raise exception 'ТЕСТ ПРОВАЛЕН: принята некорректная ссылка';
  exception when sqlstate '23514' then null; end;
  begin
    insert into public.task_values (task_id, property_id, value_text) values (t, p_txt, '   ');
    raise exception 'ТЕСТ ПРОВАЛЕН: принят пустой текст';
  exception when sqlstate '23514' then null; end;
  begin
    insert into public.task_values (task_id, property_id, value_text) values (t, p_b2, 'x');
    raise exception 'ТЕСТ ПРОВАЛЕН: принято свойство чужой доски';
  exception when sqlstate '23514' then null; end;

  -- смену типа при наличии значений блокируем
  begin
    update public.properties set type = 'text' where id = p_sel;
    raise exception 'ТЕСТ ПРОВАЛЕН: тип сменён при наличии значений';
  exception when sqlstate '23514' then null; end;

  -- вариант, выбранный в задаче, удалить нельзя
  begin
    delete from public.property_options where id = o1;
    raise exception 'ТЕСТ ПРОВАЛЕН: удалён используемый вариант';
  exception when sqlstate '23503' then null; end;

  -- переименование варианта значений не теряет
  update public.property_options set label = 'Анна К.' where id = o1;
  assert (select count(*) from public.task_values where option_id = o1) = 1,
         'T6: значение потеряно при переименовании';

  -- свойство можно удалить насовсем только после архивации
  delete from public.properties where id = p_txt;
  get diagnostics n = row_count;
  assert n = 0, 'T6: свойство удалено без архивации';
end $$;
rollback;
\echo T6 ok: типы, проверки значений, защита значений и вариантов

-- ===========================================================================
-- T7. Представления: общие видят все, личные — только владелец
-- ===========================================================================
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bob', true);
do $$
declare b uuid; n int;
begin
  insert into public.boards (name, position) values ('Доска', 'a0') returning id into b;
  insert into public.views (board_id, owner_id, name, position) values (b, auth.uid(), 'Личное Боба', 'a0');
  insert into public.views (board_id, owner_id, name, position) values (b, null,       'Общее',       'a1');

  -- нельзя создать личное представление от имени другого человека
  begin
    insert into public.views (board_id, owner_id, name, position)
      values (b, '00000000-0000-0000-0000-0000000000a1', 'Подмена', 'a2');
    raise exception 'ТЕСТ ПРОВАЛЕН: создано представление от имени другого';
  exception when sqlstate '42501' then null; end;
end $$;

select set_config('request.jwt.claim.sub', :'anna', true);
do $$
declare n int;
begin
  assert (select count(*) from public.views) = 1, 'T7: Анна должна видеть только общее представление';
  assert (select name from public.views) = 'Общее', 'T7: Анна видит не то представление';

  update public.views set name = 'Общее (правка Анны)' where name = 'Общее';
  get diagnostics n = row_count;
  assert n = 1, 'T7: общее представление должно редактироваться всеми';

  delete from public.views where name = 'Личное Боба';
  get diagnostics n = row_count;
  assert n = 0, 'T7: чужое личное представление удалено';
end $$;
rollback;
\echo T7 ok: общие и личные представления

-- ===========================================================================
-- T8. Участники: менять может только admin; добавлять и удалять нельзя через API
-- ===========================================================================
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'bob', true);
do $$
declare n int;
begin
  assert public.is_active_member(), 'T8: bob должен быть активным участником';
  assert not public.is_admin(),     'T8: bob не должен быть admin';
  assert (select count(*) from public.members) = 3, 'T8: участник должен видеть список команды';

  update public.members set role = 'admin' where user_id = auth.uid();
  get diagnostics n = row_count;
  assert n = 0, 'T8: участник повысил себя до admin';

  begin
    insert into public.members (user_id, display_name) values (gen_random_uuid(), 'Левый');
    raise exception 'ТЕСТ ПРОВАЛЕН: участник добавил участника';
  exception when sqlstate '42501' then null; end;
  begin
    delete from public.members where user_id = auth.uid();
    raise exception 'ТЕСТ ПРОВАЛЕН: участник удалил участника';
  exception when sqlstate '42501' then null; end;
end $$;

select set_config('request.jwt.claim.sub', :'anna', true);
do $$
declare n int;
begin
  assert public.is_admin(), 'T8: anna должна быть admin';
  update public.members set display_name = 'Боб' where user_id = '00000000-0000-0000-0000-0000000000b2';
  get diagnostics n = row_count;
  assert n = 1, 'T8: admin должен менять имя участника';
end $$;
rollback;
\echo T8 ok: управление участниками только у admin

\echo ============================================
\echo ВСЕ ТЕСТЫ ПРОШЛИ
