import type { TaskValue } from './types';

/**
 * Выбранные варианты списка. Поддерживает оба вида хранения:
 * старый одиночный (option_id) и новый множественный (option_ids).
 * Если в базе лежит массив, он важнее одиночного поля.
 */
export function selectedOptionIds(value: Pick<TaskValue, 'option_id' | 'option_ids'> | null | undefined): string[] {
  if (!value) return [];
  const ids = value.option_ids ?? [];
  if (ids.length > 0) return ids;
  return value.option_id ? [value.option_id] : [];
}
