/**
 * Минимальный писатель XLSX без внешних библиотек: один лист, строки, числа, даты, заголовок с фильтром.
 * Файл это ZIP (без сжатия) с несколькими XML-файлами.
 * Даты записываются настоящими датами Excel, вычисленными по календарной дате без часового пояса,
 * поэтому день не сдвигается.
 */

/** Ячейка таблицы: строка, число, дата 'YYYY-MM-DD' или пусто. */
export type Cell = string | number | { date: string } | null;

export interface Table {
  header: string[];
  rows: Cell[][];
}

// ---------------------------------------------------------------- ZIP

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const name = encoder.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // версия
    lv.setUint16(6, 0x0800, true); // имена в UTF-8
    lv.setUint16(8, 0, true); // без сжатия
    lv.setUint16(10, 0, true); // время
    lv.setUint16(12, 0x21, true); // дата 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, f.data);

    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);

    offset += local.length + size;
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((sum, p) => sum + p.length, 0));
  let pos = 0;
  for (const p of all) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

// ---------------------------------------------------------------- XML

/** Экранирует текст для XML и убирает управляющие символы, которые в XML недопустимы. */
function xml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 0 -> A, 25 -> Z, 26 -> AA */
export function columnLetter(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Серийный номер даты Excel по календарной дате 'YYYY-MM-DD' (расчёт в UTC, без часовых поясов). */
export function excelSerial(isoDate: string): number | null {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  // несуществующую дату (например, 30 февраля) не «перекатываем» на другой день
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.getTime() / 86400000 + 25569; // 25569 = дни от 1899-12-30 до 1970-01-01
}

const STYLE_DEFAULT = 0;
const STYLE_HEADER = 1;
const STYLE_WRAP = 2;
const STYLE_DATE = 3;

function cellXml(ref: string, cell: Cell, header: boolean): string {
  if (cell === null || cell === '') return '';
  if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
  if (typeof cell === 'object') {
    const serial = excelSerial(cell.date);
    return serial === null
      ? `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.date)}</t></is></c>`
      : `<c r="${ref}" s="${STYLE_DATE}"><v>${serial}</v></c>`;
  }
  const style = header ? STYLE_HEADER : cell.includes('\n') ? STYLE_WRAP : STYLE_DEFAULT;
  const s = style === STYLE_DEFAULT ? '' : ` s="${style}"`;
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xml(cell)}</t></is></c>`;
}

function columnWidths(table: Table): number[] {
  return table.header.map((h, i) => {
    let longest = h.length;
    for (const row of table.rows.slice(0, 500)) {
      const c = row[i];
      const len = typeof c === 'string' ? c.split('\n').reduce((m, l) => Math.max(m, l.length), 0) : typeof c === 'object' && c !== null ? 10 : String(c ?? '').length;
      if (len > longest) longest = len;
    }
    return Math.min(60, Math.max(8, longest + 2));
  });
}

/** Имя листа: до 31 символа, без символов \ / ? * [ ] : */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return cleaned === '' ? 'Лист1' : cleaned;
}

export function buildXlsx(table: Table, sheetName: string): Uint8Array {
  const encoder = new TextEncoder();
  const lastCol = columnLetter(Math.max(table.header.length - 1, 0));
  const widths = columnWidths(table);

  const rowsXml: string[] = [];
  const headerCells = table.header.map((h, c) => cellXml(`${columnLetter(c)}1`, h, true)).join('');
  rowsXml.push(`<row r="1">${headerCells}</row>`);
  table.rows.forEach((row, r) => {
    const cells = row.map((cell, c) => cellXml(`${columnLetter(c)}${r + 2}`, cell, false)).join('');
    rowsXml.push(`<row r="${r + 2}">${cells}</row>`);
  });

  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rowsXml.join('')}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${table.rows.length + 1}"/>` +
    '</worksheet>';

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${xml(safeSheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  return zip([
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rootRels) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
    { name: 'xl/styles.xml', data: encoder.encode(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheet) },
  ]);
}

// ---------------------------------------------------------------- CSV

/**
 * Защита от «CSV-инъекции»: ячейка, начинающаяся с = + @ (или с минуса, если это не число),
 * при открытии в Excel могла бы выполниться как формула. Перед такой строкой ставим апостроф.
 */
export function csvSafe(text: string): string {
  if (/^[=+@\t\r]/.test(text)) return `'${text}`;
  if (text.startsWith('-') && !/^-?\d+([.,]\d+)?$/.test(text)) return `'${text}`;
  return text;
}

export function buildCsv(table: Table, delimiter: ',' | ';'): string {
  const quote = (value: string) =>
    value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const text = (cell: Cell): string => {
    if (cell === null) return '';
    if (typeof cell === 'number') return String(cell);
    if (typeof cell === 'object') return cell.date; // ISO: однозначно читается любым Excel
    return csvSafe(cell);
  };
  const lines = [table.header.map((h) => quote(csvSafe(h))).join(delimiter)];
  for (const row of table.rows) lines.push(row.map((c) => quote(text(c))).join(delimiter));
  return lines.join('\r\n') + '\r\n';
}
