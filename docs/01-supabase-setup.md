# Настройка Supabase и импорт данных (этап 1)

Проект: `https://kpwsonthpczijvcesgnj.supabase.co` (панель: supabase.com/dashboard/project/kpwsonthpczijvcesgnj).

## 1. Закрыть регистрацию
Authentication → **Sign In / Providers** (или Settings):
- Email: **включён**, «Confirm email» — **выключить** (адреса технические, писем не будет);
- «Allow new users to sign up» — **выключить**. Пользователей создаёт только администратор.

## 2. Применить схему
SQL Editor → New query. Вставить и выполнить **по очереди, каждый файл целиком**:
1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_functions.sql`
3. `supabase/migrations/0003_rls.sql`

Каждый файл можно запускать повторно. Ожидаемый результат: «Success. No rows returned».

## 3. Создать пользователей (вход по нику)
Authentication → Users → **Add user → Create new user**:
- Email: `ник@qaflow.local` (ник — латиница/цифры, например `angelina@qaflow.local`);
- Password: длинный пароль (12+ символов), у каждого свой;
- **Auto Confirm User** — включить.

Профиль создаётся автоматически. Отображаемое имя (по-русски) задаётся запросом:
```sql
update public.profiles set display_name = 'Ангелина' where nickname = 'angelina';
```
Сброс пароля: Authentication → Users → пользователь → Send/Update password.
Пользователь с любым другим адресом (не `@qaflow.local`) профиль не получает и данных не видит.

## 4. Импорт из Google Sheets
1. Google Sheets: Файл → Скачать → Microsoft Excel (.xlsx). Исходную таблицу не менять.
2. На своём компьютере (нужен Python 3 и `pip install openpyxl`):
   ```
   python3 tools/import/build_seed.py "Таблица.xlsx" --board-sheet "143 релиз" --knowledge-sheet "База знаний" --out tools/import/out/seed.sql
   ```
   Скрипт напечатает число найденных задач/статей и замечания.
3. Открыть `tools/import/out/seed.sql`, вставить в SQL Editor, выполнить.
4. Внизу появится «Отчёт об импорте». Нужно `"ok": true` и совпадение `in_file` и `in_database`.
5. Файл `seed.sql` и xlsx **не коммитить** (репозиторий публичный; `.gitignore` это уже запрещает).

Повторный запуск безопасен: дубликаты не создаются, существующие записи не перезаписываются.

## 5. Проверка
- Table Editor: `tasks` — 36 строк, `knowledge_articles` — 1.
- Authentication → Policies: у всех таблиц включён RLS.
- Запрос без входа: `curl "https://kpwsonthpczijvcesgnj.supabase.co/rest/v1/tasks?select=id" -H "apikey: <publishable key>"` должен вернуть ошибку доступа (permission denied / 401), а не данные.

## 6. Резервная копия (до любых больших изменений)
Database → Backups (на бесплатном тарифе ежедневные копии недоступны). Вручную:
`pg_dump "<connection string из Project Settings → Database>" -Fc -f backup/qaflow.dump`
Папка `backup/` в `.gitignore`.
