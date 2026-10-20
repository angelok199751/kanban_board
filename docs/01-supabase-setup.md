# Настройка Supabase

Названия пунктов в панели Supabase иногда меняются. Если чего-то не нашла, пришли скриншот, и подскажу.

## 1. Закрыть регистрацию

1. Supabase → **Authentication** → **Sign In / Providers** (в старом интерфейсе: Settings).
2. Выключить **Allow new users to sign up** (публичная регистрация).
3. В настройках провайдера **Email** выключить **Confirm email**, чтобы не требовалось подтверждение почтой.

## 2. Выполнить миграции (по очереди!)

Supabase → **SQL Editor** → **New query**.

1. Вставить содержимое `supabase/migrations/001_members.sql` → **Run**. Должно закончиться словом Success.
2. Вставить содержимое `supabase/migrations/002_kanban_core.sql` → **Run**.

Если одна из миграций выдаёт ошибку, **не запускай её повторно и не правь**. Пришли мне текст ошибки целиком. Повторный запуск выдаст «already exists», и ситуация запутается.

## 3. Создать четыре учётные записи

Supabase → **Authentication** → **Users** → **Add user** → **Create new user**.

- Email: любой в формате `логин@домен`. Если у кого-то есть настоящая почта, бери её. Иначе придумай единый вид, например `anna@qaflow.example.com`. На экране входа люди будут вводить только логин (`anna`), домен приложение подставит само.
- Password: придумай каждому пароль (от 10 символов).
- Поставить галочку **Auto Confirm User**.

**Первый созданный пользователь автоматически получает роль admin** (это должна быть ты). Остальные станут обычными участниками.

Если панель отказывается принимать адрес с выбранным доменом, напиши мне, какой именно ошибкой.

## 4. Проверка, что всё закрыто

В SQL Editor выполни:

```sql
-- 1) RLS включён на всех таблицах: везде должно быть true
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- 2) Участники: должно быть 4 строки, у тебя role = admin
select display_name, role, is_active from public.members order by created_at;

-- 3) Сколько политик на каждой таблице: ни у одной не должно быть 0
select tablename, count(*) as policies
from pg_policies
where schemaname = 'public'
group by tablename
order by tablename;
```

Ожидаемо: 8 таблиц (`board_columns`, `boards`, `members`, `properties`, `property_options`, `task_values`, `tasks`, `views`), везде `rowsecurity = true`, политик больше нуля.

Пришли мне результат трёх запросов, и я сверю.

## 5. Что нужно для приложения (следующий шаг)

Из **Project Settings → API** понадобятся:
- **Project URL** (у тебя `https://kpwsonthpczijvcesgnj.supabase.co`);
- **публичный ключ**: `anon` / `publishable`. Его можно держать в коде на фронтенде, защиту обеспечивает RLS.

**Секретный ключ (`service_role` / `secret`) никому не присылай и никуда не вставляй, ни в чат, ни в код.**

## Статус выполнения

Миграции 001 и 002 применены в проекте `kpwsonthpczijvcesgnj`, проверочные запросы из п. 4 пройдены (RLS включён на всех таблицах, политики на месте, участников четверо). Эти проверки владелица проекта выполнила вручную в SQL Editor. Автоматические SQL-тесты (`tools/test/`) пока не запускались.

### Если в проекте остались таблицы от прежних попыток

Миграция 002 остановится с ошибкой «relation ... already exists». Ничего не запускай повторно и сначала посмотри, что там лежит:

```sql
select table_name from information_schema.tables where table_schema = 'public' order by table_name;
```

Если таблицы пустые и ненужные (так было при прежнем черновике схемы), их можно убрать скриптом, который сам откажется удалять, если найдёт хоть одну строку. Список таблиц подставь свой; порядок важен (сначала зависимые), `CASCADE` не используется:

```sql
do $$
declare t text; n bigint;
begin
  foreach t in array array['tasks','property_options','board_views','board_properties','board_columns','boards']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then raise exception 'В % есть % строк. Ничего не удаляю.', t, n; end if;
    end if;
  end loop;
  drop table if exists public.tasks;
  drop table if exists public.property_options;
  drop table if exists public.board_views;
  drop table if exists public.board_properties;
  drop table if exists public.board_columns;
  drop table if exists public.boards;
end $$;
```

## Ограничения и что осталось неполным

- Поиск по тексту задач (этап 5) и корзина/архив в интерфейсе (этап 7) пока без индексов и экранов: на уровне базы поля `archived_at` и `deleted_at` уже есть.
- Конфликты: у задач есть номер версии (название, описание, колонка). Значения свойств хранятся отдельно, и защиту от одновременной правки одного и того же свойства добавим в клиенте на этапе 8.
- Admin может случайно понизить сам себя или отключить последнего admin-а (через таблицу members). Пока не добавляла защиту, при необходимости добавим.
