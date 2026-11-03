import { staleKeysFor, SYNCED_TABLES } from '../../../src/lib/sync';

const eq = (a: unknown, b: unknown, m: string) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`); };

eq(staleKeysFor('tasks'), ['board', 'archive', 'search'], 'tasks');
eq(staleKeysFor('boards'), ['boards', 'archive'], 'boards');
eq(staleKeysFor('task_values'), ['board'], 'values');
eq(staleKeysFor('views'), ['views'], 'views');
eq(staleKeysFor('knowledge_articles'), ['kb-articles', 'archive'], 'articles');
eq(staleKeysFor('knowledge_bases'), ['kb-bases', 'archive'], 'bases');
eq(staleKeysFor('board_templates'), ['templates'], 'templates');
eq(staleKeysFor('unknown'), [], 'unknown table');
// каждая синхронизируемая таблица должна что-то обновлять, иначе подписка бесполезна
for (const t of SYNCED_TABLES) if (staleKeysFor(t).length === 0) throw new Error(`table ${t} has no stale keys`);
console.log('sync tests ok');
