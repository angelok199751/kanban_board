export const MAX_LABELS = 20;
export const MAX_LABEL_LENGTH = 40;

/** 'релиз, Чек-лист ,релиз' -> ['релиз', 'Чек-лист']: без пустых и повторов (регистр не важен), не больше 20 меток. */
export function parseLabels(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(',')) {
    const label = part.trim().slice(0, MAX_LABEL_LENGTH);
    if (label === '') continue;
    const key = label.toLocaleLowerCase('ru');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= MAX_LABELS) break;
  }
  return out;
}

export const labelsToText = (labels: string[]): string => labels.join(', ');

export const sameLabels = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
