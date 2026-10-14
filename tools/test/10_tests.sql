-- Тесты схемы, триггеров и RLS. Запуск (на локальной базе после 00_mock_supabase.sql, миграций и seed):
--   psql -v ON_ERROR_STOP=1 -f tools/test/10_tests.sql
-- Каждый блок откатывается; при провале psql останавливается с сообщением «ТЕСТ ПРОВАЛЕН».

\set ON_ERROR_STOP on

-- Пользователи создаются как это делает Supabase Auth (администратор в панели)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'anna@qaflow.local', '{"display_name":"Анна"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'bob@qaflow.local',  '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 'stranger@gmail.com', '{}')
on conflict do nothing;

-- T1. Профили: только для @qaflow.local
do $$ begin
  assert (select count(*) from public.profiles) = 2, 'профили: ожидалось 2';
  assert not exists (select 1 from public.profiles where nickname like 'stranger%'), 'посторонний получил профиль';
  assert (select display_name from public.profiles where nickname='anna') = 'Анна', 'display_name';
end $$;
\echo T1 ok: профили создаются только для технических адресов

-- T2. Аноним ничего не видит
begin;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.tasks;
    raise exception 'ТЕСТ ПРОВАЛЕН: аноним прочитал tasks';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo T2 ok: аноним не читает таблицы

-- T3. Вошедший, но не участник (нет профиля) — пусто и писать нельзя
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', true);
do $$ begin
  assert (select count(*) from public.tasks) = 0, 'посторонний видит задачи';
  assert (select count(*) from public.boards) = 0, 'посторонний видит доски';
  begin
    insert into public.boards (name) values ('взлом');
    raise exception 'ТЕСТ ПРОВАЛЕН: посторонний создал доску';
  exception when insufficient_privilege or check_violation or others then
    if sqlerrm like 'ТЕСТ ПРОВАЛЕН%' then raise; end if;
  end;
end $$;
rollback;
\echo T3 ok: пользователь без профиля данных не видит и не пишет

-- T4. Участник видит данные; проверка соответствия импорту
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare b uuid := (select id from public.boards limit 1);
begin
  assert (select count(*) from public.tasks) = 36, 'задач не 36';
  assert (select count(distinct number) from public.tasks) = 36, 'номера не уникальны';
  assert (select min(number) from public.tasks) = 19 and (select max(number) from public.tasks) = 68, 'диапазон номеров';
  assert (select count(*) from public.tasks where position is null or position = '') = 0, 'позиции';
  assert (select count(*) from public.board_views where board_id = b and is_default) = 1, 'общее представление';
  assert (select count(*) from public.knowledge_articles) = 1, 'статьи';
  -- версии/числа очищены
  assert (select count(*) from public.tasks where props->>'версия' like '%.0') = 0, 'версия с .0';
  assert (select props->>'версия' from public.tasks where number = 19) = '123', 'версия задачи 19';
  assert (select props->>'дата выкатки' from public.tasks where number = 19) = '2026-10-12', 'дата задачи 19';
  assert (select description from public.tasks where number = 19) = 'ааааа', 'комментарий задачи 19';
  assert (select count(*) from public.tasks where description like '%<a href=%') >= 10, 'HTML-комментарии потеряны';
  assert (select c.name from public.tasks t join public.board_columns c on c.id=t.column_id where t.number=19) = 'Готово', 'статус';
  assert (select count(*) from public.tasks where props ? 'связанная задача') = 1, 'свойство «Связанная задача»';
  assert (select type from public.board_properties where key='тестовое') = 'text', 'тип «тестовое» (смесь ссылок и текста)';
  assert (select type from public.board_properties where key='связанная задача') = 'url', 'тип «Связанная задача»';
  assert (select count(*) from public.property_options o join public.board_properties p on p.id=o.property_id
           where p.key='исполнитель' and o.color is not null) = 5, 'цвета исполнителей';
end $$;
rollback;
\echo T4 ok: данные импорта совпадают с файлом

-- T5. Создание задачи: номер, версия, оптимистичная блокировка, перенос, порядок
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  b uuid := (select id from public.boards limit 1);
  c1 uuid := (select id from public.board_columns where name='В работе');
  c2 uuid := (select id from public.board_columns where name='Готово');
  t uuid := gen_random_uuid();
  n int; v int; rc int;
begin
  insert into public.tasks (id, board_id, title, column_id, position) values (t, b, 'Новая', c1, 'a9');
  select number into n from public.tasks where id = t;
  assert n = 69, 'следующий номер 69, получили ' || n;
  -- идемпотентность: тот же id повторно → нарушение уникальности (клиент считает успехом)
  begin
    insert into public.tasks (id, board_id, title, column_id, position) values (t, b, 'Новая', c1, 'a9');
    raise exception 'ТЕСТ ПРОВАЛЕН: дубль id принят';
  exception when unique_violation then null; end;

  update public.tasks set column_id = c2, position = 'aV' where id = t and version = 1;
  get diagnostics rc = row_count; assert rc = 1, 'перенос не применился';
  select version into v from public.tasks where id = t; assert v = 2, 'версия не выросла';
  update public.tasks set title = 'Чужое' where id = t and version = 1;   -- устаревшая версия
  get diagnostics rc = row_count; assert rc = 0, 'устаревшая версия не должна применяться';

  update public.tasks set number = 999 where id = t;
  assert (select number from public.tasks where id = t) = 69, 'номер изменился';

  -- столбец чужой доски
  insert into public.boards (name) values ('Вторая');
  begin
    update public.tasks set column_id = (select c.id from public.board_columns c join public.boards bb on bb.id=c.board_id
                                          where bb.name='Вторая' limit 1) where id = t;
    raise exception 'ТЕСТ ПРОВАЛЕН: карточка ушла в столбец другой доски';
  exception when check_violation then null; end;
  -- вторая доска получила свой набор
  assert (select count(*) from public.board_columns c join public.boards bb on bb.id=c.board_id where bb.name='Вторая') = 14, 'столбцы новой доски';
  assert (select count(*) from public.board_views v join public.boards bb on bb.id=v.board_id where bb.name='Вторая' and v.is_default) = 1, 'представление новой доски';
  assert (select count(*) from public.board_properties p join public.boards bb on bb.id=p.board_id where bb.name='Вторая') = 10, 'свойства новой доски';
end $$;
rollback;
\echo T5 ok: номер, версии, блокировка, защита от чужого столбца, bootstrap доски

-- T6. Порядок столбцов одним вызовом
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  b uuid := (select id from public.boards limit 1);
  ids uuid[]; first_before uuid; tasks_before text;
begin
  select array_agg(id order by position desc) into ids from public.board_columns where board_id = b;
  select string_agg(id::text || column_id::text, ',' order by id) into tasks_before from public.tasks;
  perform public.reorder_columns(b, ids);
  assert (select id from public.board_columns where board_id = b order by position limit 1) = ids[1], 'порядок не применился';
  assert (select string_agg(id::text || column_id::text, ',' order by id) from public.tasks) = tasks_before, 'карточки изменились при перестановке столбцов';
  begin
    perform public.reorder_columns(b, ids[1:3]);
    raise exception 'ТЕСТ ПРОВАЛЕН: принят неполный список';
  exception when serialization_failure then null; end;
end $$;
rollback;
\echo T6 ok: перестановка столбцов не трогает карточки; неполный список отклоняется

-- T7. Архив столбца и карточек, корзина
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  b uuid := (select id from public.boards limit 1);
  done_c uuid := (select id from public.board_columns where name='Готово');
  work_c uuid := (select id from public.board_columns where name='В работе');
  n int; one uuid;
begin
  -- отдельная карточка в архив заранее
  select id into one from public.tasks where column_id = done_c limit 1;
  update public.tasks set archived_at = now() - interval '1 day' where id = one;

  n := public.archive_column(done_c);
  assert n = 28, 'в архив столбца ушло ' || n || ', ожидалось 28';
  assert (select archived_at from public.board_columns where id = done_c) is not null, 'столбец не архивирован';
  assert (select count(*) from public.tasks where archived_at is null and deleted_at is null) = 7, 'активных должно остаться 7';

  n := public.restore_column(done_c);
  assert n = 28, 'вернулось ' || n;
  assert (select archived_at from public.tasks where id = one) is not null, 'ранее архивная карточка вернулась без запроса';

  -- возврат одной карточки при архивном столбце вернёт и столбец
  perform public.archive_column(done_c);
  perform public.restore_task(one);
  assert (select archived_at from public.board_columns where id = done_c) is null, 'столбец должен вернуться с карточкой';

  -- корзина
  update public.tasks set deleted_at = now() where id = one;
  assert (select deleted_by from public.tasks where id = one) = auth.uid(), 'deleted_by';
  delete from public.tasks where id = (select id from public.tasks where deleted_at is null and column_id = work_c limit 1);
  get diagnostics n = row_count; assert n = 0, 'удалил не из корзины';
  delete from public.tasks where id = one;
  get diagnostics n = row_count; assert n = 1, 'не удалил из корзины';
  update public.tasks set deleted_at = null where id = (select id from public.tasks where deleted_at is not null limit 1);  -- восстановление нечего
end $$;
rollback;
\echo T7 ok: архив столбца, возврат, корзина, окончательное удаление только из корзины

-- T8. Представления: личные и общее
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare b uuid := (select id from public.boards limit 1); n int;
begin
  insert into public.board_views (board_id, owner_id, name, config) values (b, auth.uid(), 'Мой вид', '{"sort":{"key":"номер"}}');
  begin
    insert into public.board_views (board_id, owner_id, name, is_default) values (b, null, 'второе общее', true);
    raise exception 'ТЕСТ ПРОВАЛЕН: второе общее представление';
  exception when unique_violation or check_violation or insufficient_privilege or others then
    if sqlerrm like 'ТЕСТ ПРОВАЛЕН%' then raise; end if; end;
  begin
    insert into public.board_views (board_id, owner_id, name) values (b, '00000000-0000-0000-0000-0000000000b2', 'за другого');
    raise exception 'ТЕСТ ПРОВАЛЕН: создал представление за другого';
  exception when others then if sqlerrm like 'ТЕСТ ПРОВАЛЕН%' then raise; end if; end;
  begin
    delete from public.board_views where board_id = b and is_default;
    get diagnostics n = row_count;
    assert n = 0, 'общее представление удалено';
  end;
  update public.board_views set config = '{"x":1}' where board_id = b and is_default;
  get diagnostics n = row_count; assert n = 1, 'общее представление не редактируется';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
do $$
declare b uuid := (select id from public.boards limit 1);
begin
  assert (select count(*) from public.board_views where board_id = b) = 1, 'Боб видит чужое личное представление';
end $$;
rollback;
\echo T8 ok: личные представления изолированы, общее одно и неудаляемо

-- T9. Профиль: менять можно имя/настройки, но не ник и не active; отчёты недоступны
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare n int;
begin
  update public.profiles set settings = '{"theme":"dark"}' where id = auth.uid();
  get diagnostics n = row_count; assert n = 1, 'не удалось сохранить настройки';
  begin
    update public.profiles set active = false where id = auth.uid();
    raise exception 'ТЕСТ ПРОВАЛЕН: изменил active';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set nickname = 'hacker' where id = auth.uid();
    raise exception 'ТЕСТ ПРОВАЛЕН: изменил ник';
  exception when insufficient_privilege then null; end;
  update public.profiles set display_name = 'Хакер' where id <> auth.uid();
  get diagnostics n = row_count; assert n = 0, 'изменил чужой профиль';
  begin
    perform count(*) from public.import_reports;
    raise exception 'ТЕСТ ПРОВАЛЕН: читает import_reports';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo T9 ok: профили и служебные таблицы защищены

-- T10. Статьи: версия
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare a uuid := (select id from public.knowledge_articles limit 1); v int;
begin
  update public.knowledge_articles set title = 'Новая' where id = a;
  select version into v from public.knowledge_articles where id = a;
  assert v = 2, 'версия статьи';
  assert (select updated_by from public.knowledge_articles where id = a) = auth.uid(), 'updated_by';
end $$;
rollback;
\echo T10 ok: статьи

\echo ВСЕ ТЕСТЫ ПРОЙДЕНЫ
