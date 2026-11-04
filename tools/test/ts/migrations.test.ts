// Статическая проверка миграций: никто не должен забыть закрыть новую таблицу.
// Читает SQL как текст, базу не запускает. Не заменяет SQL-тесты (tools/test/10_tests.sql), а страхует от самой частой ошибки.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));
const files = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
if (files.length === 0) throw new Error('миграции не найдены');
// комментарии убираем, чтобы слова из них не засчитывались
const sql = files.map((f) => readFileSync(join(dir, f), 'utf-8')).join('\n').replace(/--[^\n]*/g, '');

const tables = [...sql.matchAll(/create\s+table\s+public\.(\w+)/gi)].map((m) => m[1]);
if (tables.length < 12) throw new Error(`ожидалось не меньше 12 таблиц, найдено ${tables.length}`);
if (!tables.includes('task_docs')) throw new Error('миграция 009: не найдена таблица task_docs');

const problems: string[] = [];
const rlsEnabled = new Set([...sql.matchAll(/alter\s+table\s+public\.(\w+)\s+enable\s+row\s+level\s+security/gi)].map((m) => m[1]));

// revoke all on public.a, public.b, ... from anon
const revoked = new Set<string>();
for (const m of sql.matchAll(/revoke\s+all\s+on\s+([\s\S]*?)\s+from\s+([\w,\s]+?);/gi)) {
  if (!/\banon\b/.test(m[2])) continue;
  for (const t of m[1].matchAll(/public\.(\w+)/g)) revoked.add(t[1]);
}

// политики по таблицам
const policies = new Map<string, number>();
for (const m of sql.matchAll(/create\s+policy\s+\w+\s+on\s+public\.(\w+)/gi)) policies.set(m[1], (policies.get(m[1]) ?? 0) + 1);

// таблицы в публикации realtime
const realtime = new Set<string>();
for (const m of sql.matchAll(/alter\s+publication\s+supabase_realtime\s+add\s+table\s+([\s\S]*?);/gi)) {
  for (const t of m[1].matchAll(/public\.(\w+)/g)) realtime.add(t[1]);
}

// Список участников не нужно рассылать; состояние CRDT (task_docs) тоже:
// оно ходит через Broadcast-канал карточки, а не через postgres_changes.
const NOT_REALTIME = new Set(['members', 'task_docs']);
for (const t of tables) {
  if (!rlsEnabled.has(t)) problems.push(`${t}: не включён row level security`);
  if (!revoked.has(t)) problems.push(`${t}: у роли anon не отозваны права (revoke all ... from anon)`);
  if ((policies.get(t) ?? 0) === 0) problems.push(`${t}: нет ни одной политики`);
  if (!NOT_REALTIME.has(t) && !realtime.has(t)) problems.push(`${t}: не добавлена в публикацию supabase_realtime`);
}

// политики не должны разрешать anon и не должны быть «для всех»
if (/create\s+policy[\s\S]*?\bto\s+(anon|public)\b/i.test(sql)) problems.push('есть политика для anon или public');
if (/using\s*\(\s*true\s*\)/i.test(sql)) problems.push('есть политика using (true): открыта всем');
// каждая политика обязана проверять участника
for (const m of sql.matchAll(/create\s+policy\s+(\w+)\s+on\s+public\.(\w+)([\s\S]*?);/gi)) {
  if (m[2] === 'members' && /is_admin\(\)|is_active_member\(\)/.test(m[3])) continue;
  if (!/is_active_member\(\)/.test(m[3])) problems.push(`политика ${m[1]} на ${m[2]} не проверяет is_active_member()`);
}
// функции с правами владельца (security definer) обязаны фиксировать search_path
for (const m of sql.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)[\s\S]*?\$\$;/gi)) {
  if (/security\s+definer/i.test(m[0]) && !/set\s+search_path/i.test(m[0])) problems.push(`функция ${m[1]}: security definer без set search_path`);
}

if (problems.length > 0) throw new Error('Проблемы в миграциях:\n - ' + problems.join('\n - '));
console.log(`migrations tests ok: ${files.length} файлов, ${tables.length} таблиц (${tables.join(', ')})`);
