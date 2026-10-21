import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Порядок хранится текстовыми ключами (fractional indexing): чтобы поставить элемент
 * между двумя соседями, достаточно выдать ключ между их ключами, остальные строки не трогаем.
 * Бросает ошибку, если ключи соседей равны или идут в обратном порядке (тогда нужна перенумерация).
 */
export function keyBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

/** n новых ключей по порядку: для перенумерации списка целиком. */
export function nKeys(n: number): string[] {
  return generateNKeysBetween(null, null, n);
}

/** Сортировка как в базе (collate "C"): по ключу, при равенстве по id. */
export function compareByPosition(a: { position: string; id: string }, b: { position: string; id: string }): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * План обновления порядка после переноса элемента.
 * orderedIds: все элементы списка в НОВОМ порядке; positions: их текущие ключи.
 * Обычно меняется один ключ (между соседями). Если ключи соседей совпали или перепутаны,
 * весь список получает новые ключи.
 */
export function planMove(
  positions: Map<string, string>,
  orderedIds: string[],
  movedId: string,
): { id: string; position: string }[] | null {
  const i = orderedIds.indexOf(movedId);
  if (i < 0) return null;
  const before = i > 0 ? (positions.get(orderedIds[i - 1]) ?? null) : null;
  const after = i < orderedIds.length - 1 ? (positions.get(orderedIds[i + 1]) ?? null) : null;
  try {
    return [{ id: movedId, position: keyBetween(before, after) }];
  } catch {
    const keys = nKeys(orderedIds.length);
    return orderedIds.map((id, idx) => ({ id, position: keys[idx] }));
  }
}
