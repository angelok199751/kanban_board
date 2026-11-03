/** Таблицы, изменения которых приходят в реальном времени. */
export const SYNCED_TABLES = [
  'boards',
  'board_columns',
  'tasks',
  'task_values',
  'properties',
  'property_options',
  'views',
  'knowledge_bases',
  'knowledge_articles',
  'board_templates',
] as const;

/**
 * Какие запросы устарели после изменения таблицы (ключи верхнего уровня в кэше).
 * Данные обновляются заново из базы, а не «склеиваются» из событий: так не бывает дублей и потерь.
 */
export function staleKeysFor(table: string): string[] {
  switch (table) {
    case 'boards':
      return ['boards', 'archive'];
    case 'board_columns':
      return ['board', 'archive'];
    case 'tasks':
      return ['board', 'archive', 'search'];
    case 'task_values':
    case 'properties':
    case 'property_options':
      return ['board'];
    case 'views':
      return ['views'];
    case 'knowledge_bases':
      return ['kb-bases', 'archive'];
    case 'knowledge_articles':
      return ['kb-articles', 'archive'];
    case 'board_templates':
      return ['templates'];
    default:
      return [];
  }
}
