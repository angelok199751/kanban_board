-- =====================================================================
-- QA Flow · миграция 008 · шаблоны досок
-- =====================================================================
-- Шаблон хранит только структуру доски: колонки, свойства, варианты списков
-- и настройки отображения. Карточки, их значения и представления в шаблон
-- не попадают. Шаблон — независимый снимок: изменения исходной доски его
-- не меняют.
--
-- Структура лежит в JSON, поэтому шаблон не связан внешними ключами с доской
-- или её таблицами. Проверка содержимого выполняется в приложении, база
-- следит только за тем, чтобы это был объект.
-- =====================================================================

create table public.board_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 100),
  structure  jsonb not null check (jsonb_typeof(structure) = 'object'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index board_templates_created_idx on public.board_templates (created_at);

create trigger board_templates_touch before update on public.board_templates
  for each row execute function public.touch_row();

-- ---------------------------------------------------------------------
-- RLS: шаблоны общие для активных участников
-- ---------------------------------------------------------------------
alter table public.board_templates enable row level security;

create policy templates_select on public.board_templates for select to authenticated
  using (public.is_active_member());
create policy templates_insert on public.board_templates for insert to authenticated
  with check (public.is_active_member());
create policy templates_update on public.board_templates for update to authenticated
  using (public.is_active_member()) with check (public.is_active_member());
create policy templates_delete on public.board_templates for delete to authenticated
  using (public.is_active_member());

-- ---------------------------------------------------------------------
-- Права доступа: аноним не получает ничего
-- ---------------------------------------------------------------------
revoke all on public.board_templates from anon, authenticated;
grant select, insert, update, delete on public.board_templates to authenticated;

-- ---------------------------------------------------------------------
-- Realtime: список шаблонов обновляется у всех открытых вкладок
-- ---------------------------------------------------------------------
alter table public.board_templates replica identity full;
alter publication supabase_realtime add table public.board_templates;
