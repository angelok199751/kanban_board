-- QA Flow: схема данных (этап 1).
-- Запускать в Supabase → SQL Editor целиком, по порядку: 0001, 0002, 0003.
-- Миграция идемпотентна для таблиц (create ... if not exists) и безопасна для повторного запуска.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Пользователи
-- ---------------------------------------------------------------------------
-- Вход по нику: в Supabase Auth заводится пользователь с почтой <ник>@qaflow.local.
-- Профиль создаётся автоматически и только для таких адресов.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  nickname     text not null unique check (nickname ~ '^[a-z0-9_.-]{2,32}$'),
  display_name text not null,
  active       boolean not null default true,
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Рабочая область: доски и базы знаний
-- ---------------------------------------------------------------------------
create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> '' and char_length(name) <= 100),
  position    int  not null default 0,
  archived_at timestamptz,
  next_number int  not null default 1,        -- следующий номер задачи на доске
  legacy_key  text unique,                    -- ключ исходного листа (для импорта)
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

create table if not exists public.knowledge_bases (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> '' and char_length(name) <= 100),
  position    int  not null default 0,
  archived_at timestamptz,
  legacy_key  text unique,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

-- ---------------------------------------------------------------------------
-- Свойства доски. Единый реестр: и встроенные, и созданные пользователем.
-- Значения задач:
--   number/title/status/longtext → поля tasks (number, title, column_id, description)
--   text/url/select/date         → tasks.props ->> key
-- ---------------------------------------------------------------------------
create table if not exists public.board_properties (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references public.boards(id) on delete cascade,
  key           text not null check (btrim(key) <> '' and char_length(key) <= 80),
  title         text not null check (btrim(title) <> '' and char_length(title) <= 60),
  type          text not null check (type in ('number','title','status','longtext','text','url','select','date')),
  builtin       boolean not null default false,
  position      int not null default 0,
  hidden        boolean not null default false,
  legacy_header text,
  unique (board_id, key)
);

-- Значения выпадающих списков вместе с цветом (для любых select-свойств).
create table if not exists public.property_options (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.board_properties(id) on delete cascade,
  value       text not null check (btrim(value) <> '' and char_length(value) <= 120),
  color       text check (color in ('red','orange','yellow','green','blue','purple','pink','gray')),
  position    int not null default 0,
  unique (property_id, value)
);

-- ---------------------------------------------------------------------------
-- Столбцы канбана (= статусы). Порядок столбцов хранится отдельно от карточек.
-- ---------------------------------------------------------------------------
create table if not exists public.board_columns (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards(id) on delete cascade,
  name        text not null check (btrim(name) <> '' and char_length(name) <= 120 and left(name,1) <> '='),
  color       text check (color in ('red','orange','yellow','green','blue','purple','pink','gray')),
  position    int not null default 0,
  archived_at timestamptz,                    -- столбец целиком отправлен в архив
  unique (board_id, name)
);

-- ---------------------------------------------------------------------------
-- Задачи
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards(id) on delete cascade,
  number      int,                                                    -- заполняет триггер
  title       text not null check (btrim(title) <> '' and char_length(title) <= 1000),
  column_id   uuid not null references public.board_columns(id) on delete restrict,
  position    text not null collate "C",                              -- дробный индекс внутри столбца
  description text not null default '' check (char_length(description) <= 500000),
  props       jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object'),
  archived_at timestamptz,
  archived_by uuid,
  deleted_at  timestamptz,
  deleted_by  uuid,
  version     int not null default 1,
  legacy_id   text unique,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (board_id, number)
);
create index if not exists tasks_board_active_idx
  on public.tasks (board_id, column_id, position)
  where deleted_at is null and archived_at is null;
create index if not exists tasks_board_archived_idx
  on public.tasks (board_id, archived_at) where archived_at is not null and deleted_at is null;
create index if not exists tasks_board_deleted_idx
  on public.tasks (board_id, deleted_at) where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- Представления. owner_id = null → общее стартовое представление (одно на доску).
-- Остальные — личные.
-- ---------------------------------------------------------------------------
create table if not exists public.board_views (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards(id) on delete cascade,
  owner_id   uuid references auth.users(id) on delete cascade,
  name       text not null check (btrim(name) <> '' and char_length(name) <= 60),
  position   int not null default 0,
  config     jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  check (is_default = (owner_id is null))
);
create unique index if not exists board_views_one_default
  on public.board_views (board_id) where is_default;

-- ---------------------------------------------------------------------------
-- Базы знаний
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_articles (
  id         uuid primary key default gen_random_uuid(),
  base_id    uuid not null references public.knowledge_bases(id) on delete cascade,
  title      text not null check (btrim(title) <> '' and char_length(title) <= 300),
  content    text not null default '' check (char_length(content) <= 500000),
  labels     text not null default '' check (char_length(labels) <= 200),
  deleted_at timestamptz,
  version    int not null default 1,
  legacy_id  text unique,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists knowledge_articles_base_idx
  on public.knowledge_articles (base_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Отчёты импорта (читает только владелец проекта через SQL Editor)
-- ---------------------------------------------------------------------------
create table if not exists public.import_reports (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  report     jsonb not null
);
