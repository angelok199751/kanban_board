/**
 * Список карточек колонки для сохранения порядка, когда на экране видна только часть карточек
 * (поиск или фильтры). Переносимая карточка ставится сразу после своего видимого предшественника
 * (или перед видимым следующим), скрытые карточки остаются на своих местах.
 */
export function mergeIntoFull(full: string[], visibleFinal: string[], movedId: string): string[] {
  const base = full.filter((id) => id !== movedId);
  const idx = visibleFinal.indexOf(movedId);
  if (idx < 0) return [...base, movedId];

  const prev = idx > 0 ? visibleFinal[idx - 1] : undefined;
  if (prev !== undefined) {
    const at = base.indexOf(prev);
    if (at >= 0) {
      base.splice(at + 1, 0, movedId);
      return base;
    }
  }
  const next = idx < visibleFinal.length - 1 ? visibleFinal[idx + 1] : undefined;
  if (next !== undefined) {
    const at = base.indexOf(next);
    if (at >= 0) {
      base.splice(at, 0, movedId);
      return base;
    }
  }
  return [...base, movedId];
}
