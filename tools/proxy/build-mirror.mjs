// Собирает зеркало приложения для сетей, где блокируется supabase.co.
// Отличие от обычной сборки только одно: VITE_SUPABASE_URL указывает на
// Cloudflare Worker, а готовые файлы кладутся в dist/mirror.
//
// Использование:
//   PowerShell: $env:SUPABASE_PROXY_URL='https://qaflow-proxy.example.workers.dev'; npm run build:mirror
//   bash:       SUPABASE_PROXY_URL='https://qaflow-proxy.example.workers.dev' npm run build:mirror
//   или:        node tools/proxy/build-mirror.mjs https://qaflow-proxy.example.workers.dev

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const raw = (process.env.SUPABASE_PROXY_URL || process.argv[2] || '').trim().replace(/\/+$/, '');

if (!raw) {
  console.error(
    'Не задан адрес прокси. Укажи SUPABASE_PROXY_URL (адрес Cloudflare Worker) ' +
      'или передай его первым аргументом.',
  );
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(raw);
} catch {
  console.error(`Некорректный адрес прокси: ${raw}`);
  process.exit(1);
}

const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';

if (!['http:', 'https:'].includes(parsed.protocol) || (parsed.protocol !== 'https:' && !isLocal)) {
  console.error('Прокси должен быть https-адресом (http разрешён только для localhost).');
  process.exit(1);
}
if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
  console.error('Укажи только адрес Worker без пути, query string и логина: https://<worker>.workers.dev');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const vitePackage = require.resolve('vite/package.json');
const viteBin = join(dirname(vitePackage), 'bin', 'vite.js');

console.log(`Сборка зеркала: SUPABASE_URL=${raw}`);
const result = spawnSync(process.execPath, [viteBin, 'build', '--outDir', 'dist/mirror'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: raw },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
