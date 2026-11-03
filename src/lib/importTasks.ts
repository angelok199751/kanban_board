import { isValidUrl } from './format';

/** Свойство, в которое попадает ссылка из второй колонки Excel. */
export const TASK_LINK_PROPERTY = 'Ссылка на задачу';

/** Строка таблицы импорта. Пропущенные строки без названия сюда не попадают. */
export interface ImportRow {
  /** Номер строки в исходном тексте, чтобы человек мог найти ошибку. */
  line: number;
  title: string;
  link: string;
  /** Ссылка есть, но не похожа на http(s)-адрес. */
  invalidLink: boolean;
}

export interface ParsedImport {
  rows: ImportRow[];
  /** Строки, где есть ссылка, но нет названия: карточку создать нельзя. */
  skipped: number;
  /** Первая строка оказалась заголовком таблицы и была пропущена. */
  headerSkipped: boolean;
}

/** Что сделать при импорте, если свойства «Ссылка на задачу» ещё нет. */
export interface ImportOptions {
  createLinkProperty?: boolean;
}

/** Итог импорта: сколько карточек создано и у скольких сохранилась ссылка. */
export interface ImportResult {
  created: number;
  linked: number;
  invalidLinks: number;
  linkPropertyCreated: boolean;
  /** Ссылки удалось сохранить: нашлось свойство типа «Ссылка». */
  linksSaved: boolean;
}

const HEADER_TITLES = new Set(['название', 'задача', 'заголовок', 'title', 'name', 'task']);
const HEADER_LINKS = new Set(['ссылка', 'ссылка на задачу', 'link', 'url']);

const headerLike = (title: string, link: string): boolean => {
  const t = title.trim().toLowerCase();
  const l = link.trim().toLowerCase();
  return HEADER_TITLES.has(t) && (l === '' || HEADER_LINKS.has(l));
};

/**
 * Разбирает таблицу, скопированную из Excel: две колонки через Tab.
 * Первая колонка — название карточки, вторая — ссылка. Ссылка не обязательна.
 * Пустые строки пропускаются; лишние колонки не мешают.
 */
export function parseImportTable(text: string): ParsedImport {
  const rows: ImportRow[] = [];
  let skipped = 0;
  let headerSkipped = false;
  let checkedHeader = false;

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;

    const cells = line.split('\t');
    const title = (cells[0] ?? '').trim();
    const link = (cells[1] ?? '').trim();

    if (!checkedHeader) {
      checkedHeader = true;
      if (headerLike(title, link)) {
        headerSkipped = true;
        continue;
      }
    }

    if (title === '') {
      skipped += 1;
      continue;
    }

    rows.push({ line: i + 1, title, link, invalidLink: link !== '' && !isValidUrl(link) });
  }

  return { rows, skipped, headerSkipped };
}

/** Короткая сводка для предупреждений в диалоге импорта. */
export function importSummary(parsed: ParsedImport): { total: number; withLink: number; invalidLinks: number } {
  let withLink = 0;
  let invalidLinks = 0;
  for (const row of parsed.rows) {
    if (row.link !== '') withLink += 1;
    if (row.invalidLink) invalidLinks += 1;
  }
  return { total: parsed.rows.length, withLink, invalidLinks };
}
