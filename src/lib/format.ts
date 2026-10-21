// Ссылка должна начинаться с http:// или https:// (то же правило, что и в базе данных).
const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

export function isValidUrl(value: string): boolean {
  return URL_RE.test(value);
}

/** Короткое имя для ссылки на карточке: домен без www. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 'YYYY-MM-DD' -> 'дд.мм.гггг'. Строку разбираем вручную: объект Date сдвинул бы день из-за часового пояса. */
export function formatDate(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
}

export const PROPERTY_TYPE_LABELS = {
  select: 'Выпадающий список',
  text: 'Текст',
  url: 'Ссылка',
  date: 'Дата',
} as const;
