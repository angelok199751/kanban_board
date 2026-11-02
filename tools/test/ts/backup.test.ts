// Проверка скрипта резервной копии на локальном сервере-имитации (без Supabase и сети).
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore: обычный .mjs без типов
import { runBackup, TABLES } from '../../backup/backup.mjs';

const eq = (a: unknown, b: unknown, m: string) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`); };

const MAX_PER_REQUEST = 700; // сервер отдаёт меньше, чем просят: копия не должна на этом обрезаться
const data: Record<string, unknown[]> = Object.fromEntries(TABLES.map(([t]: [string]) => [t, []]));
data.tasks = Array.from({ length: 2500 }, (_, i) => ({ id: String(i).padStart(5, '0'), title: `Карточка ${i}`, description_html: '<p>текст</p>' }));
data.boards = [{ id: 'b1', name: 'Релиз' }];
data.task_values = [{ task_id: 't1', property_id: 'p1', value_text: 'x' }];
const seen: { auth?: unknown; tokens: Set<string>; urls: string[] } = { tokens: new Set(), urls: [] };

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const send = (code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/auth/v1/token') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      seen.auth = { grant: url.searchParams.get('grant_type'), apikey: req.headers.apikey, email: body.email };
      if (body.password !== 'верный') return send(400, { error: 'Invalid login credentials' });
      send(200, { access_token: 'TOKEN-1' });
    });
    return;
  }
  const m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
  if (!m || !(m[1] in data)) return send(404, { message: 'нет такой таблицы' });
  seen.tokens.add(String(req.headers.authorization));
  seen.urls.push(url.search);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 1000), MAX_PER_REQUEST);
  send(200, data[m[1]].slice(offset, offset + limit));
});

await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as { port: number }).port;
const base = { url: `http://127.0.0.1:${port}`, key: 'PUB-KEY', email: 'an@qaflow.test' };
const out = mkdtempSync(join(tmpdir(), 'qaflow-backup-'));

try {
  // неверный пароль: понятная ошибка, ничего не записано
  let failed = false;
  try { await runBackup({ ...base, password: 'не тот', outRoot: out }); } catch (e) { failed = /Не удалось войти/.test((e as Error).message); }
  eq(failed, true, 'неверный пароль даёт понятную ошибку');
  eq(readdirSync(out).length, 0, 'при ошибке входа ничего не создано');

  const { dir, counts } = await runBackup({ ...base, password: 'верный', outRoot: out, now: new Date(2026, 9, 24, 14, 5) });
  eq(seen.auth, { grant: 'password', apikey: 'PUB-KEY', email: 'an@qaflow.test' }, 'вход идёт по паролю с публичным ключом');
  eq([...seen.tokens], ['Bearer TOKEN-1'], 'чтение идёт с токеном вошедшего участника');
  eq(counts.tasks, 2500, 'все 2500 карточек прочитаны, хотя сервер отдаёт по 700');
  eq(counts.boards, 1, 'доски');
  eq(counts.knowledge_articles, 0, 'пустая таблица');
  eq(dir.endsWith('qaflow-2026-10-24_1405'), true, 'имя папки по дате и времени');

  const tasks = JSON.parse(readFileSync(join(dir, 'tasks.json'), 'utf-8'));
  eq(tasks.length, 2500, 'в файле все карточки');
  eq(new Set(tasks.map((t: { id: string }) => t.id)).size, 2500, 'без повторов');
  eq(tasks[0].title, 'Карточка 0', 'порядок и кириллица');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  eq(manifest.counts.tasks, 2500, 'в описании копии верное число');
  eq(manifest.source, base.url, 'в описании указан источник');
  eq(readdirSync(dir).length, TABLES.length + 1, 'файл на каждую таблицу и описание');
  eq(seen.urls.some((u) => u.includes('order=task_id.asc,property_id.asc')), true, 'составной ключ сортировки для значений свойств');
  eq(JSON.stringify(manifest).includes('верный'), false, 'пароль нигде не сохраняется');
  console.log('backup tests ok');
} finally {
  server.close();
}
