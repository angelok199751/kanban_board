# SQL-тесты схемы и RLS

Проверяют миграции `supabase/migrations/001_members.sql`, `002_kanban_core.sql` и `003_search.sql`: доступ анонима и деактивированных участников, нумерацию и версии задач, защиту от потери данных (архив, корзина, внешние ключи), проверку значений свойств, представления, права на управление участниками.

Тесты используют вымышленные данные и **выполняются только на локальной базе**. `00_mock_supabase.sql` имитирует роли и схему `auth` Supabase и на настоящем проекте не запускается.

## Запуск (нужен PostgreSQL 14 или новее)

```
createdb qaflow_test
psql -v ON_ERROR_STOP=1 -d qaflow_test -f tools/test/00_mock_supabase.sql
psql -v ON_ERROR_STOP=1 -d qaflow_test -f supabase/migrations/001_members.sql
psql -v ON_ERROR_STOP=1 -d qaflow_test -f supabase/migrations/002_kanban_core.sql
psql -v ON_ERROR_STOP=1 -d qaflow_test -f supabase/migrations/003_search.sql
psql -v ON_ERROR_STOP=1 -d qaflow_test -f tools/test/10_tests.sql
```

Успех: последняя строка `ВСЕ ТЕСТЫ ПРОШЛИ`. Перед повторным прогоном базу пересоздай (`dropdb qaflow_test && createdb qaflow_test`), потому что блок T1 оставляет тестовых пользователей.

## Статус

Тесты написаны, но **ещё ни разу не запускались**: в среде, где они готовились, нет PostgreSQL. Пока их не прогонят, считать схему проверенной тестами нельзя.
