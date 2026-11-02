import { formatDate, hostOf, isValidUrl } from './format';
import type { ColorName, Property, PropertyOption, PropertyType, TaskValue } from './types';

/** Готовое к показу значение свойства («пилюля») на карточке доски и в сводке окна карточки. */
export interface CardField {
  id: string;
  name: string;
  type: PropertyType;
  text: string;
  tone?: ColorName; // цвет пилюли: у списка цвет варианта, у даты оранжевый, у текста серый
  url?: string; // для ссылки: адрес (пилюля кликабельна)
}

/**
 * Значения свойств карточки в виде пилюль, в порядке свойств. Пустые значения пропускаются.
 * Текстовые свойства показываются с названием («Заметка: …»): по одному значению не понять, что это.
 */
export function buildCardFields(
  properties: Property[],
  values: Map<string, TaskValue> | undefined,
  optionById: Map<string, PropertyOption>,
): CardField[] {
  if (!values) return [];
  const out: CardField[] = [];
  for (const p of properties) {
    const v = values.get(p.id);
    if (!v) continue;
    const base = { id: p.id, name: p.name, type: p.type };
    if (p.type === 'select') {
      const option = v.option_id ? optionById.get(v.option_id) : undefined;
      if (option) out.push({ ...base, text: option.label, tone: option.color });
    } else if (p.type === 'date') {
      if (v.value_date) out.push({ ...base, text: formatDate(v.value_date), tone: 'orange' });
    } else if (p.type === 'url') {
      if (v.value_text) {
        out.push(
          isValidUrl(v.value_text)
            ? { ...base, text: hostOf(v.value_text), url: v.value_text }
            : { ...base, text: `${p.name}: ${v.value_text}`, tone: 'gray' },
        );
      }
    } else if (v.value_text) {
      out.push({ ...base, text: `${p.name}: ${v.value_text}`, tone: 'gray' });
    }
  }
  return out;
}
