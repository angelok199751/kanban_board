import type { TaskValue } from './types';

export type ValueInput = Omit<TaskValue, 'updated_at'>;

/**
 * Значения для копии карточки: только заполненные, с новым task_id.
 * Служебные поля (id строки не существует, updated_at) не переносятся.
 */
export function copyValueInputs(taskId: string, values: TaskValue[]): ValueInput[] {
  return values
    .filter(
      (v) =>
        v.value_text !== null ||
        v.value_date !== null ||
        v.option_id !== null ||
        (v.option_ids?.length ?? 0) > 0,
    )
    .map((v) => ({
      task_id: taskId,
      property_id: v.property_id,
      value_text: v.value_text,
      value_date: v.value_date,
      option_id: v.option_id,
      option_ids: v.option_ids ?? [],
    }));
}

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
