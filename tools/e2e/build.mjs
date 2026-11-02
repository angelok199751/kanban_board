// Собирает НАСТОЯЩИЙ код приложения (src/) вместе с упрощёнными заменами трёх библиотек и поддельной базой в памяти.
// Так можно прогнать сценарии в браузере без Supabase. Это проверка логики интерфейса, а не замена проверке на реальной базе.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const { build } = await import(process.env.ESBUILD_MODULE || 'esbuild');
const shim = (name) => path.join(here, 'shims', name);

mkdirSync(path.join(here, 'dist'), { recursive: true });
await build({
  entryPoints: [path.join(here, '..', '..', 'src', 'main.tsx')],
  bundle: true,
  outdir: path.join(here, 'dist'),
  format: 'iife',
  jsx: 'automatic',
  alias: {
    '@supabase/supabase-js': shim('fake-supabase.js'),
    '@tanstack/react-query': shim('react-query.js'),
    '@dnd-kit/core': shim('dnd-core.js'),
    '@dnd-kit/sortable': shim('dnd-sortable.js'),
    '@dnd-kit/utilities': shim('dnd-utilities.js'),
    'fractional-indexing': shim('fractional-indexing.js'),
  },
  plugins: [
    {
      name: 'test-config',
      setup(b) {
        b.onResolve({ filter: /\/config$/ }, () => ({ path: path.join(here, 'test-config.ts') }));
      },
    },
  ],
  nodePaths: [path.join(here, '..', '..', 'node_modules'), ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : [])],
  loader: { '.css': 'css' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});
writeFileSync(
  path.join(here, 'dist', 'index.html'),
  '<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="main.css"></head><body><div id="root"></div><script src="main.js"></script></body></html>',
);
console.log('Собрано:', path.join(here, 'dist'));
