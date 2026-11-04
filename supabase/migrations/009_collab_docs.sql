-- =====================================================================
-- QA Flow · миграция 009: совместное редактирование описания
-- =====================================================================
-- Описание карточки теперь живёт в CRDT (Yjs): несколько человек могут
-- печатать в одном описании одновременно, правки сливаются без потерь.
-- Здесь хранится снимок состояния документа Yjs (в base64), чтобы новый
-- участник получал не только последний HTML, но и всю историю правок.
--
-- Состояние небольшое (обычный текст описания), поэтому снимок целиком
-- перезаписывается при изменении: так проще и надёжнее, чем журнал правок.
--
-- Внимание: миграцию нужно применить в Supabase вручную (SQL Editor),
-- как и предыдущие.
-- =====================================================================

create table public.task_docs (
  task_id    uuid primary key references public.tasks (id) on delete cascade,
  state      text not null check (char_length(state) <= 2000000),
  updated_at timestamptz not null default now()
);

create trigger task_docs_touch before insert or update on public.task_docs
  for each row execute function public.touch_row();

-- ---------------------------------------------------------------------
-- RLS: как у остальных данных доски — только активным участникам.
-- ---------------------------------------------------------------------
alter table public.task_docs enable row level security;

create policy task_docs_select on public.task_docs for select to authenticated
  using (public.is_active_member());
create policy task_docs_insert on public.task_docs for insert to authenticated
  with check (public.is_active_member());
create policy task_docs_update on public.task_docs for update to authenticated
  using (public.is_active_member()) with check (public.is_active_member());
create policy task_docs_delete on public.task_docs for delete to authenticated
  using (public.is_active_member());

revoke all on public.task_docs from anon, authenticated;
grant select, insert, update, delete on public.task_docs to authenticated;

-- ---------------------------------------------------------------------
-- Версия карточки больше не меняется от правки одного описания.
-- Иначе два человека, печатающие в описании, постоянно «конфликтовали» бы
-- с тем, кто в это время правит название, хотя правки не пересекаются.
-- Название, колонка, позиция, архив и корзина по-прежнему увеличивают версию.
-- ---------------------------------------------------------------------
create or replace function public.touch_task()
returns trigger
language plpgsql
as $$
begin
  new.id         := old.id;
  new.board_id   := old.board_id;
  new.number     := old.number;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.version    := case
    when new.title is distinct from old.title
      or new.column_id is distinct from old.column_id
      or new.position is distinct from old.position
      or new.archived_at is distinct from old.archived_at
      or new.deleted_at is distinct from old.deleted_at
    then old.version + 1
    else old.version
  end;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
