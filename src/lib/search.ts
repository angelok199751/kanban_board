/**
 * Шаблон для ilike внутри значения фильтра PostgREST.
 * 1) экранируем подстановочные символы LIKE (\ % _), чтобы поиск был буквальным;
 * 2) значение берём в двойные кавычки, а внутри кавычек экранируем \ и ",
 *    иначе запятая или скобка в запросе сломали бы фильтр.
 */
export function likePattern(query: string): string {
  const escapedForLike = query.replace(/[\\%_]/g, (c) => '\\' + c);
  const raw = `%${escapedForLike}%`;
  const quoted = raw.replace(/[\\"]/g, (c) => '\\' + c);
  return `"${quoted}"`;
}
