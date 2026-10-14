const CONFIG = {
  SPREADSHEET_ID: 'REDACTED_SPREADSHEET_ID',
  SHEET_NAME: ''
};

// Служебный столбец с устойчивым идентификатором задачи.
// Создаётся автоматически справа от данных и скрывается.
const ID_HEADER = '_id';
const DATE_FORMAT = 'dd.MM.yyyy';

// Известные поля (внутренние ключи). Остальные столбцы таблицы
// обнаруживаются автоматически по заголовкам.
const FIELDS = [
  'номер', 'задача', 'статус', 'исполнитель', 'разраб',
  'дата выкатки', 'категория', 'флоу', 'версия', 'коммент'
];

const SELECT_FIELDS = ['статус', 'исполнитель', 'разраб', 'категория', 'флоу'];
const DATE_FIELDS = ['дата выкатки'];
// Поля с форматированным текстом (хранятся как очищенный HTML либо как обычный текст).
const LONGTEXT_FIELDS = ['коммент'];
const SORTED_SELECTS = ['исполнитель', 'разраб', 'категория'];

// Допустимые цвета значений списков (этап 2).
const COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'];
// Лимит ячейки Google Sheets — 50 000 символов.
const MAX_CELL_LENGTH = 49000;

// Настройки свойств доски (раздел 5 ТЗ): общие для всех, по одному свойству скрипта на лист.
const PROPCFG_PREFIX = 'props_';
// Типы пользовательских свойств по ТЗ: Текст, Гиперссылка, Выпадающий список, Дата.
// longtext остаётся только как внутреннее значение для встроенного поля «коммент».
const PROP_TYPES = ['text', 'url', 'select', 'date'];
const MAX_PROP_CFG_BYTES = 8500;
const MAX_PROP_OPTIONS = 100;
const MAX_PROP_TITLE = 60;
const PROP_NO_HIDE = ['задача', 'номер'];

const STATUSES = [
  'Залито', 'Не залито', 'Без теста', 'В работе', 'Ждём правки',
  'Ждём уточнений', 'На доработке', 'Залиты правки', 'Готово', 'Откатили',
  'Не берём в релиз', 'Реализовано в рамках другой задачи',
  'Уже на проде', 'Дубликат', 'Архив'
];

const ALIASES = {
  'номер': ['номер', 'id', '№', '№ п/п', 'номер задачи'],
  'задача': ['задача', 'название', 'task'],
  'статус': ['статус', 'status'],
  'исполнитель': ['исполнитель', 'qa', 'тестировщик'],
  'разраб': ['разраб', 'разработчик', 'developer'],
  'дата выкатки': ['дата выкатки', 'выкатка', 'релиз'],
  'категория': ['категория', 'тип'],
  'флоу': ['флоу', 'flow', 'проект'],
  'версия': ['версия', 'version'],
  'коммент': ['коммент', 'комментарий', 'comment']
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('QA Flow');
}

function include(filename) {
  // getRawContent() — без обработки как шаблона. Иначе GAS режет код
  // по // внутри template literals и ломает document.write в браузере.
  return HtmlService.createTemplateFromFile(filename).getRawContent();
}

/* ---------- Общие помощники ---------- */

// Лист выбирается явно по sheetId. Без sheetId берётся лист по умолчанию.
function getSheet_(sheetId) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = null;

  if (sheetId !== undefined && sheetId !== null && sheetId !== '') {
    sheet = ss.getSheets().find(s => s.getSheetId() === Number(sheetId));
    if (!sheet) throw new Error('Лист доски не найден. Обнови страницу.');
  } else {
    sheet = CONFIG.SHEET_NAME ? ss.getSheetByName(CONFIG.SHEET_NAME) : ss.getSheets()[0];
  }

  if (!sheet) throw new Error('Лист не найден.');
  return sheet;
}

function tzOf_(sheet) {
  return sheet.getParent().getSpreadsheetTimeZone();
}

function normalize_(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

// Размер в байтах (кириллица занимает 2 байта), а не в символах.
// Нужен и цветам, и представлениям: лимит свойства скрипта — ~9 КБ.
function byteLen_(s) {
  let n = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/* ---------- Форматированный текст (описание задачи) ---------- */

// Формат хранения в ячейке:
//  • без форматирования — обычный текст с переводами строк (как раньше);
//  • с форматированием — HTML из белого списка тегов без атрибутов:
//    b, i, u, s, ul, ol, li, div, br.
// Любой другой HTML очищается; скрипты, стили и атрибуты не сохраняются.
const RICH_TAG_RE = /<\/?(b|strong|i|em|u|s|strike|del|ul|ol|li|br|div|p|a)\b[^>]*>/i;
const RICH_TAG_MAP = {
  b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u',
  s: 's', strike: 's', del: 's',
  ul: 'ul', ol: 'ol', li: 'li', div: 'div', p: 'div',
  a: 'a'
};
// Ссылки в тексте: допускаются только http(s), атрибут один — href.
const MAX_LINK_LENGTH = 2000;

function escapeRichText_(text) {
  return text
    .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Значение href из текста открывающего тега <a ...>.
function extractHref_(tagText) {
  const m = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tagText);
  if (!m) return '';
  const raw = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
  return String(raw)
    .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Только http(s) (адрес без протокола получает https://). Всё остальное, включая javascript:, отбрасывается.
function safeLinkHref_(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > MAX_LINK_LENGTH || /[\x00-\x1f\x7f]/.test(s)) return '';
  return normalizeUrl_(s) || '';
}

function sanitizeHtml_(html) {
  const source = String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let out = '';
  let last = 0;
  let linkOpen = false;
  let m;

  while ((m = re.exec(source))) {
    out += escapeRichText_(source.slice(last, m.index));
    last = re.lastIndex;

    const tag = m[2].toLowerCase();
    const closing = m[1] === '/';

    if (tag === 'br') {
      if (!closing) out += '<br>';
    } else if (tag === 'a') {
      if (closing) {
        if (linkOpen) { out += '</a>'; linkOpen = false; }
      } else if (!linkOpen) {
        const href = safeLinkHref_(extractHref_(m[0]));
        if (href) { out += '<a href="' + escapeAttr_(href) + '">'; linkOpen = true; }
      }
    } else if (RICH_TAG_MAP[tag]) {
      out += '<' + (closing ? '/' : '') + RICH_TAG_MAP[tag] + '>';
    }
  }

  out += escapeRichText_(source.slice(last));
  return linkOpen ? out + '</a>' : out;
}

function visibleTextEmpty_(html) {
  return !/<li>/.test(html) &&
    html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
}

// Если форматирования нет (только строки), хранится обычный текст:
// таблицу удобно читать и править руками.
function simplifyRich_(html) {
  if (/<\/?(?:b|i|u|s|ul|ol|li)>|<a href=|<\/a>/.test(html)) return html;

  let text = html
    .replace(/<div><br><\/div>/g, '<div></div>')
    .replace(/<div>/g, '\n')
    .replace(/<\/div>/g, '')
    .replace(/<br>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

  text = text.replace(/^\n/, '').replace(/\n+$/, '');

  // Текст содержит угловые скобки: оставляем HTML, чтобы он не принялся за теги.
  if (/[<>]/.test(text)) return RICH_TAG_RE.test(html) ? html : '<div>' + html + '</div>';
  return text;
}

function normalizeRich_(value) {
  const s = String(value ?? '');
  if (!s.trim()) return '';
  if (!RICH_TAG_RE.test(s)) return s;

  const clean = sanitizeHtml_(s);
  if (visibleTextEmpty_(clean)) return '';
  return simplifyRich_(clean);
}

function checkCellLength_(text) {
  if (text.length > MAX_CELL_LENGTH) {
    throw new Error('Описание слишком длинное для ячейки таблицы. Сократи текст.');
  }
}

/* ---------- Даты ---------- */

function isoOrEmpty_(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return '';
  }
  return y + '-' + pad2_(m) + '-' + pad2_(d);
}

// Понимает дд.мм.гггг и гггг-мм-дд. Всё остальное считается обычным текстом.
function parseDateText_(text) {
  const s = String(text ?? '').trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return isoOrEmpty_(+m[3], +m[2], +m[1]);
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return isoOrEmpty_(+m[1], +m[2], +m[3]);
  return '';
}

function isRealDate_(v) {
  return v instanceof Date && !isNaN(v.getTime());
}

/* ---------- Схема таблицы (динамические свойства) ---------- */

function typeForKnownKey_(key) {
  if (key === 'номер') return 'id';
  if (key === 'задача') return 'title';
  if (LONGTEXT_FIELDS.includes(key)) return 'longtext';
  if (DATE_FIELDS.includes(key)) return 'date';
  if (SELECT_FIELDS.includes(key)) return 'select';
  return 'text';
}

// Читает заголовки первой строки. Известные столбцы получают привычные
// ключи, остальные обнаруживаются автоматически. Столбцы, чьи заголовки
// начинаются с «_», считаются служебными и в интерфейс не попадают.
function buildSchema_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol) throw new Error('В таблице нет заголовков в первой строке.');

  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const used = {};
  const props = [];
  let idCol = 0;

  headers.forEach((header, i) => {
    const title = String(header).trim();
    if (!title) return;

    const norm = normalize_(title);
    if (norm === ID_HEADER) {
      idCol = i + 1;
      return;
    }
    if (title.charAt(0) === '_') return;

    let key = FIELDS.find(f =>
      !used[f] && (ALIASES[f] || [f]).map(normalize_).includes(norm)
    );
    const builtin = !!key;

    if (!key) {
      key = norm;
      let n = 2;
      while (used[key] || FIELDS.includes(key)) key = norm + ' ' + n++;
    }

    used[key] = true;
    props.push({
      key,
      title,
      col: i + 1,
      builtin,
      type: builtin ? typeForKnownKey_(key) : null
    });
  });

  const byKey = {};
  props.forEach(p => { byKey[p.key] = p; });

  const missing = ['задача', 'статус'].filter(key => !byKey[key]);
  if (missing.length) {
    const names = missing.map(key => '«' + (key.charAt(0).toUpperCase() + key.slice(1)) + '» (подойдут заголовки: ' +
      (ALIASES[key] || [key]).join(', ') + ')');
    throw new Error(
      'В первой строке таблицы не найден обязательный столбец: ' + names.join('; ') + '. ' +
      'Добавь его вручную: заголовки приложение само не меняет.'
    );
  }

  return { props, byKey, idCol, lastCol };
}

// Добавляет скрытый служебный столбец _id, если его ещё нет.
function ensureIdColumn_(sheet, alreadyLocked) {
  let schema = buildSchema_(sheet);
  if (schema.idCol) return schema;

  const create = () => {
    if (buildSchema_(sheet).idCol) return;
    const col = sheet.getLastColumn() + 1;
    if (col > sheet.getMaxColumns()) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), col - sheet.getMaxColumns());
    }
    sheet.getRange(1, col).setValue(ID_HEADER);
    try { sheet.hideColumns(col); } catch (e) { /* не критично */ }
    SpreadsheetApp.flush();
  };

  if (alreadyLocked) create();
  else withLock_(create);

  return buildSchema_(sheet);
}

// Для пользовательских столбцов: «Дата» определяется по значениям.
// Выпадающий список (select) определяется отдельно в getBoardData.
function resolveCustomTypes_(sheet, schema) {
  applyPropCfgTypes_(schema, readPropCfg_(sheet));
  const lastRow = sheet.getLastRow();

  schema.props.forEach(p => {
    if (p.type) return;
    if (lastRow < 2) { p.type = 'text'; return; }

    const values = sheet.getRange(2, p.col, lastRow - 1, 1).getValues()
      .map(r => r[0]).filter(v => v !== '' && v != null);

    p.type = values.length && values.every(isRealDate_) ? 'date' : 'text';
  });
}

/* ---------- Чтение значений ---------- */

function serialize_(prop, raw, display, tz) {
  if (prop.type === 'date') {
    if (isRealDate_(raw)) return Utilities.formatDate(raw, tz, 'yyyy-MM-dd');
    const text = String(display ?? '').trim();
    return parseDateText_(text) || text;
  }
  return String(display ?? '');
}

// Проверяет значение списка по правилу проверки данных ячейки, в которую оно будет записано.
// Так вместо общей ошибки Google Sheets пользователь получает понятное сообщение.
function validateAgainstRule_(sheet, row, prop, value) {
  const text = String(value ?? '').trim();
  if (!text || row > sheet.getMaxRows()) return;

  let rule = null;
  let options = null;
  try {
    rule = sheet.getRange(row, prop.col).getDataValidation();
    if (!rule || rule.getAllowInvalid()) return;
    options = optionsFromRule_(rule);
  } catch (e) {
    return;
  }

  if (!options || options.includes(text)) return;

  throw new Error(
    '«' + (prop.title || prop.key) + '»: значение «' + text + '» не разрешено правилами таблицы. ' +
    'Допустимо: ' + options.slice(0, 8).join(', ') + (options.length > 8 ? '…' : '') + '.'
  );
}

function isRuleChecked_(prop) {
  return prop.type === 'select' || prop.key === 'статус';
}

function readRowValues_(sheet, row, schema, tz) {
  const range = sheet.getRange(row, 1, 1, sheet.getLastColumn());
  const raw = range.getValues()[0];
  const disp = range.getDisplayValues()[0];
  const values = {};
  schema.props.forEach(p => {
    values[p.key] = serialize_(p, raw[p.col - 1], disp[p.col - 1], tz);
  });
  return values;
}

function readBody_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { raw: [], disp: [] };

  const range = sheet.getRange(2, 1, lastRow - 1, lastCol);
  return { raw: range.getValues(), disp: range.getDisplayValues() };
}

function findRowsNeedingIds_(schema, body) {
  const titleCol = schema.byKey['задача'].col;
  const seen = {};
  const need = [];

  body.raw.forEach((row, i) => {
    if (!String(body.disp[i][titleCol - 1] || '').trim()) return;
    const id = String(row[schema.idCol - 1] || '').trim();
    if (!id || seen[id]) need.push(i);
    else seen[id] = true;
  });

  return need;
}

// Выдаёт ID задачам без ID и тем, у кого он продублировался
// (например, строку скопировали). Остальные данные не трогает.
function assignMissingIds_(sheet, schema) {
  withLock_(() => {
    const body = readBody_(sheet);
    const need = findRowsNeedingIds_(schema, body);
    if (!need.length) return;

    const range = sheet.getRange(2, schema.idCol, body.raw.length, 1);
    const values = range.getValues();
    need.forEach(i => { values[i][0] = newId_(); });
    range.setValues(values);
    SpreadsheetApp.flush();
  });
}

function findRowById_(sheet, idCol, id) {
  const lastRow = sheet.getLastRow();
  if (!id || lastRow < 2) return 0;

  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().map(r => String(r[0]).trim());
  const index = ids.indexOf(String(id).trim());
  return index === -1 ? 0 : index + 2;
}

/* ---------- Выпадающие списки ---------- */

function readRules_(sheet, lastCol) {
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  const grid = sheet.getRange(2, 1, rows, lastCol).getDataValidations();
  const rules = {};

  grid.forEach(row => {
    row.forEach((rule, c) => {
      if (rule && !rules[c + 1]) rules[c + 1] = rule;
    });
  });

  return rules;
}

function optionsFromRule_(rule) {
  if (!rule) return null;

  const criteria = rule.getCriteriaType();
  const values = rule.getCriteriaValues();
  const clean = list => [...new Set(
    list.map(v => String(v).trim()).filter(Boolean)
  )];

  if (criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
    return clean(values[0] || []);
  }

  if (criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
    return clean(values[0].getDisplayValues().flat());
  }

  return null;
}

/* ---------- Цвета значений ---------- */

// Цвета хранятся в свойствах скрипта отдельно для каждого листа:
// { "статус": { "Готово": "green" }, "флоу": { ... } }.
// Привязка идёт к самому значению, а не к его позиции в списке,
// поэтому порядок элементов на цвет не влияет.
function colorsKey_(sheetId) {
  return 'colors_' + sheetId;
}

function readColors_(sheet) {
  const raw = PropertiesService.getScriptProperties().getProperty(colorsKey_(sheet.getSheetId()));
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

// color = '' снимает цвет со значения.
function saveValueColor(sheetId, propKey, value, color) {
  const key = String(propKey ?? '');
  const val = String(value ?? '').trim();
  const name = String(color ?? '');

  if (!key || !val) throw new Error('Не указано значение, для которого выбирается цвет.');
  if (name && !COLOR_NAMES.includes(name)) throw new Error('Неизвестный цвет.');

  return withLock_(() => {
    const sheet = getSheet_(sheetId);

    if (!buildSchema_(sheet).byKey[key]) {
      throw new Error('Свойство не найдено. Обнови доску.');
    }

    const colors = readColors_(sheet);

    if (name) {
      if (!colors[key]) colors[key] = {};
      colors[key][val] = name;
    } else if (colors[key]) {
      delete colors[key][val];
      if (!Object.keys(colors[key]).length) delete colors[key];
    }

    const json = JSON.stringify(colors);
    // Лимит свойства скрипта считается в байтах: кириллица занимает 2 байта на символ.
    if (byteLen_(json) > 8500) {
      throw new Error('Слишком много назначенных цветов. Сними цвета с неиспользуемых значений.');
    }

    PropertiesService.getScriptProperties().setProperty(colorsKey_(sheet.getSheetId()), json);
    return { ok: true, colors };
  });
}

/* ---------- Представления доски (этап 3) ---------- */

// Единая реализация. Представление — это только настройки показа
// (фильтры, порядок и скрытые столбцы, поля карточки, сортировка);
// задачи не копируются, все представления работают с одними строками листа.
//
// Каждое представление лежит в отдельном свойстве скрипта view_<sheetId>_<id>:
// правки разных людей не затирают друг друга, а лимит ~9 КБ действует
// на одно представление, а не на все сразу.
//
// Формат представления (канонический):
//   { id, name, pos,
//     filters: { "<ключ свойства>": ["значение", ...] | { from: "гггг-мм-дд", to: "гггг-мм-дд" } },
//     columns: { order: [статусы], hidden: [статусы] },
//     sort: { key, dir: "asc"|"desc" } | null,
//     cardProps: ["ключ", ...] | null,
//     search?: "строка поиска", text?: { "<ключ>": "подстрока" } }
//
// Раньше существовала вторая версия (ключи view:<sheetId>:<id>, фильтры в виде
// { search, values, text, dates }, поле props). Её данные не теряются:
// они читаются, приводятся к каноническому формату и при первом же сохранении
// или удалении представления переносятся на новый ключ.
const VIEW_PREFIX = 'view_';
const LEGACY_VIEW_PREFIX = 'view:';
const DEFAULT_VIEW_ID = 'all';
const MAX_VIEW_BYTES = 8500;
const MAX_VIEWS = 30;
const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];

function isPlainObject_(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function cleanList_(list, maxItems, maxLen) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach(v => {
    if (out.length >= maxItems) return;
    const s = String(v ?? '').slice(0, maxLen);
    if (!out.includes(s)) out.push(s);
  });
  return out;
}

// Признак старого формата фильтров: { search, values, text, dates }.
// В каноническом формате значения — только массивы или { from, to },
// поэтому строка в search или объект массивов в values однозначно выдают старый вид.
function isLegacyFilters_(f) {
  if (!isPlainObject_(f)) return false;
  if (typeof f.search === 'string') return true;
  return isPlainObject_(f.values) &&
    !('from' in f.values) && !('to' in f.values) &&
    Object.keys(f.values).every(k => Array.isArray(f.values[k]));
}

// Приводит представление старой версии (или присланное клиентом в старой
// форме) к каноническому виду. Для канонического ввода ничего не меняет.
function toCanonicalView_(raw) {
  const src = isPlainObject_(raw) ? raw : {};
  const out = Object.assign({}, src);

  if (isLegacyFilters_(src.filters)) {
    const f = src.filters;
    const filters = {};

    Object.keys(f.values || {}).forEach(k => { filters[k] = f.values[k]; });
    Object.keys(f.dates || {}).forEach(k => { filters[k] = f.dates[k]; });

    out.filters = filters;
    if (typeof f.search === 'string') out.search = f.search;
    if (isPlainObject_(f.text)) out.text = f.text;
  }

  if (!('cardProps' in out) && Array.isArray(src.props)) out.cardProps = src.props;

  return out;
}

// Приводит представление к безопасному виду: лишние поля отбрасываются,
// размеры ограничиваются, опасные ключи удаляются.
function sanitizeView_(raw) {
  if (!isPlainObject_(raw)) throw new Error('Некорректное представление.');

  const src = toCanonicalView_(raw);
  const id = String(src.id ?? '');
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(id)) throw new Error('Некорректный идентификатор представления.');

  let name = String(src.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!name) name = id === DEFAULT_VIEW_ID ? 'Все задачи' : 'Без названия';

  const pos = id === DEFAULT_VIEW_ID
    ? 0
    : (Number.isFinite(Number(src.pos)) ? Number(src.pos) : Date.now());

  // Условия показа: список допустимых значений или диапазон дат.
  const filters = {};
  const fsrc = isPlainObject_(src.filters) ? src.filters : {};
  const iso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : '';

  Object.keys(fsrc).slice(0, 30).forEach(key => {
    if (!key || key.length > 80 || BAD_KEYS.includes(key)) return;
    const f = fsrc[key];

    if (Array.isArray(f)) {
      const list = cleanList_(f, 100, 120);
      if (list.length) filters[key] = list;
    } else if (isPlainObject_(f)) {
      const range = { from: iso(f.from), to: iso(f.to) };
      if (range.from || range.to) filters[key] = range;
    }
  });

  const cols = isPlainObject_(src.columns) ? src.columns : {};
  const columns = {
    order: cleanList_(cols.order, 80, 120),
    hidden: cleanList_(cols.hidden, 80, 120)
  };

  let sort = null;
  if (isPlainObject_(src.sort) && src.sort.key) {
    sort = {
      key: String(src.sort.key).slice(0, 80),
      dir: src.sort.dir === 'desc' ? 'desc' : 'asc'
    };
  }

  const cardProps = Array.isArray(src.cardProps) ? cleanList_(src.cardProps, 30, 80) : null;

  const view = { id, name, pos, filters, columns, sort, cardProps };

  // Дополнительные условия из старой версии: поиск и «содержит».
  const search = String(src.search ?? '').trim().slice(0, 100);
  if (search) view.search = search;

  if (isPlainObject_(src.text)) {
    const text = {};
    Object.keys(src.text).slice(0, 30).forEach(key => {
      if (!key || key.length > 80 || BAD_KEYS.includes(key)) return;
      const s = String(src.text[key] ?? '').trim().slice(0, 100);
      if (s) text[key] = s;
    });
    if (Object.keys(text).length) view.text = text;
  }

  return view;
}

function viewKey_(sheetId, id) {
  return VIEW_PREFIX + sheetId + '_' + id;
}

function legacyViewKey_(sheetId, id) {
  return LEGACY_VIEW_PREFIX + sheetId + ':' + id;
}

// Читает представления листа: новые ключи и (если их ещё не перенесли)
// старые. Если у представления есть обе записи, главной считается новая.
function readViews_(sheet) {
  const all = PropertiesService.getScriptProperties().getProperties();
  const sheetId = sheet.getSheetId();
  const prefix = VIEW_PREFIX + sheetId + '_';
  const legacyPrefix = LEGACY_VIEW_PREFIX + sheetId + ':';
  const byId = {};

  Object.keys(all).forEach(key => {
    const isNew = key.indexOf(prefix) === 0;
    const isLegacy = key.indexOf(legacyPrefix) === 0;
    if (!isNew && !isLegacy) return;

    try {
      const view = sanitizeView_(JSON.parse(all[key]));
      const idFromKey = key.slice(isNew ? prefix.length : legacyPrefix.length);
      if (view.id !== idFromKey) return;
      if (isNew || !byId[view.id]) byId[view.id] = view;
    } catch (e) { /* битая запись пропускается, остальные не страдают */ }
  });

  return Object.keys(byId)
    .map(id => byId[id])
    .sort((a, b) => (a.pos - b.pos) || a.name.localeCompare(b.name, 'ru'));
}

// Создаёт или обновляет одно представление. Задач не касается.
// Возвращает и само представление, и актуальный список (клиенту подойдёт любой).
function saveView(sheetId, view) {
  const clean = sanitizeView_(view);
  const json = JSON.stringify(clean);

  if (byteLen_(json) > MAX_VIEW_BYTES) {
    throw new Error('Настройки представления слишком большие. Убери часть условий.');
  }

  return withLock_(() => {
    const sheet = getSheet_(sheetId);
    const props = PropertiesService.getScriptProperties();
    const key = viewKey_(sheet.getSheetId(), clean.id);
    const legacyKey = legacyViewKey_(sheet.getSheetId(), clean.id);

    if (clean.id !== DEFAULT_VIEW_ID && !props.getProperty(key) && !props.getProperty(legacyKey)) {
      if (readViews_(sheet).length >= MAX_VIEWS) {
        throw new Error('Достигнут лимит представлений (' + MAX_VIEWS + '). Удали ненужные.');
      }
    }

    props.setProperty(key, json);
    // Старая запись удаляется только после успешной записи новой.
    props.deleteProperty(legacyKey);

    return { ok: true, view: clean, views: readViews_(sheet) };
  });
}

// Удаляет только настройки показа (в обоих форматах ключей).
// Основное представление удалить нельзя.
function deleteView(sheetId, id) {
  const viewId = String(id ?? '');
  if (viewId === DEFAULT_VIEW_ID) throw new Error('Основное представление удалить нельзя.');
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(viewId)) throw new Error('Некорректный идентификатор представления.');

  return withLock_(() => {
    const sheet = getSheet_(sheetId);
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty(viewKey_(sheet.getSheetId(), viewId));
    props.deleteProperty(legacyViewKey_(sheet.getSheetId(), viewId));
    return { ok: true, views: readViews_(sheet) };
  });
}

/* ---------- Свойства: показ, порядок, названия, значения, новые столбцы ---------- */

// Что хранится в настройках свойств листа:
//   order   — порядок свойств в интерфейсе (порядок столбцов в таблице не меняется);
//   hidden  — свойства, скрытые в карточке задачи (столбец и данные остаются в таблице);
//   titles  — отображаемые названия: заголовок столбца в таблице не трогаем,
//             поэтому связи с данными, цветами и представлениями не рвутся;
//   types   — тип пользовательского столбца (у встроенных полей тип фиксирован);
//   options — значения списков, добавленные из интерфейса, сверх правила таблицы.
// Удалять столбцы приложение сознательно не умеет: свойство можно только скрыть.
function propCfgKey_(sheetId) {
  return PROPCFG_PREFIX + sheetId;
}

function emptyPropCfg_() {
  return { order: [], hidden: [], titles: {}, types: {}, options: {} };
}

// schema (необязательно): если передана, лишние ключи отбрасываются.
function sanitizePropCfg_(raw, schema) {
  const src = isPlainObject_(raw) ? raw : {};
  const cfg = emptyPropCfg_();
  const known = schema ? schema.byKey : null;
  const ok = key => typeof key === 'string' && !!key && key.length <= 80 &&
    !BAD_KEYS.includes(key) && (!known || !!known[key]);

  cfg.order = cleanList_(src.order, 80, 80).filter(ok);
  cfg.hidden = cleanList_(src.hidden, 80, 80).filter(k => ok(k) && !PROP_NO_HIDE.includes(k));

  if (isPlainObject_(src.titles)) {
    Object.keys(src.titles).slice(0, 80).forEach(k => {
      if (!ok(k)) return;
      const t = String(src.titles[k] ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_PROP_TITLE);
      if (t) cfg.titles[k] = t;
    });
  }

  if (isPlainObject_(src.types)) {
    Object.keys(src.types).slice(0, 80).forEach(k => {
      if (!ok(k) || (known && known[k].builtin)) return;
      if (PROP_TYPES.includes(src.types[k])) cfg.types[k] = src.types[k];
    });
  }

  if (isPlainObject_(src.options)) {
    Object.keys(src.options).slice(0, 80).forEach(k => {
      if (!ok(k)) return;
      const list = [...new Set(
        cleanList_(src.options[k], MAX_PROP_OPTIONS, 120).map(v => v.trim()).filter(Boolean)
      )];
      if (list.length) cfg.options[k] = list;
    });
  }

  return cfg;
}

function readPropCfg_(sheet) {
  const raw = PropertiesService.getScriptProperties().getProperty(propCfgKey_(sheet.getSheetId()));
  if (!raw) return emptyPropCfg_();

  try {
    return sanitizePropCfg_(JSON.parse(raw), null);
  } catch (e) {
    return emptyPropCfg_();
  }
}

function writePropCfg_(sheet, cfg) {
  const json = JSON.stringify(cfg);
  if (byteLen_(json) > MAX_PROP_CFG_BYTES) {
    throw new Error('Слишком много настроек свойств. Убери лишние значения списков.');
  }
  PropertiesService.getScriptProperties().setProperty(propCfgKey_(sheet.getSheetId()), json);
}

// Тип пользовательского столбца, заданный в настройках, важнее автоопределения.
function applyPropCfgTypes_(schema, cfg) {
  schema.props.forEach(p => {
    if (!p.builtin && cfg.types[p.key]) p.type = cfg.types[p.key];
  });
}

// Свойства из order занимают те же «места», что и раньше, но в заданном порядке;
// остальные (например, новые столбцы) остаются на своих местах.
function orderProps_(props, order) {
  const listed = order.filter(k => props.some(p => p.key === k));
  const byKey = {};
  props.forEach(p => { byKey[p.key] = p; });

  const out = props.slice();
  const slots = [];
  props.forEach((p, i) => { if (listed.includes(p.key)) slots.push(i); });
  slots.forEach((slot, i) => { out[slot] = byKey[listed[i]]; });

  return out;
}

function savePropertyConfig(sheetId, cfgRaw) {
  return withLock_(() => {
    const sheet = getSheet_(sheetId);
    const schema = buildSchema_(sheet);
    const cfg = sanitizePropCfg_(cfgRaw, schema);

    // Тип пользовательского столбца нельзя «снять», только заменить: если клиент
    // его не прислал, остаётся прежний, чтобы не потерять тип (например, дату).
    const prev = readPropCfg_(sheet);
    Object.keys(prev.types).forEach(k => {
      if (schema.byKey[k] && !schema.byKey[k].builtin && !(k in cfg.types)) cfg.types[k] = prev.types[k];
    });

    // Название, совпадающее с заголовком столбца, не хранится как переопределение.
    Object.keys(cfg.titles).forEach(k => {
      if (schema.byKey[k].title === cfg.titles[k]) delete cfg.titles[k];
    });

    const seen = {};
    schema.props.forEach(p => {
      const title = cfg.titles[p.key] || p.title;
      const norm = normalize_(title);
      if (seen[norm]) throw new Error('Названия свойств должны быть разными: «' + title + '».');
      seen[norm] = true;
    });

    // Смена типа — это и настройка, и изменение самого столбца: проверка данных,
    // формат ячеек и подсветка прежнего типа убираются, значения сохраняются.
    const before = effectiveCustomTypes_(sheet, schema, prev);
    const tz = tzOf_(sheet);
    const converted = [];

    Object.keys(cfg.types).forEach(k => {
      if (cfg.types[k] === before[k]) return;
      applyColumnType_(sheet, schema.byKey[k].col, cfg.types[k], cfg.options[k] || [], tz);
      converted.push(k);
    });

    writePropCfg_(sheet, cfg);
    if (converted.length) SpreadsheetApp.flush();
    return { ok: true, config: cfg, converted };
  });
}

/**
 * Явно приводит столбец к выбранному типу (кнопка «Исправить в таблице»
 * и смена типа). Данные не удаляются: даты и текст переводятся друг в друга,
 * нераспознанные значения остаются как есть.
 */
function changePropertyType(sheetId, key, type) {
  const newType = String(type ?? '');
  if (!PROP_TYPES.includes(newType)) throw new Error('Неизвестный тип свойства.');

  return withLock_(() => {
    const sheet = getSheet_(sheetId);
    const schema = buildSchema_(sheet);
    const prop = schema.byKey[String(key ?? '')];

    if (!prop) throw new Error('Свойство не найдено. Обнови доску.');
    if (prop.builtin) throw new Error('Тип встроенного свойства менять нельзя.');

    const cfg = readPropCfg_(sheet);
    applyColumnType_(sheet, prop.col, newType, cfg.options[prop.key] || [], tzOf_(sheet));

    cfg.types[prop.key] = newType;
    writePropCfg_(sheet, cfg);
    SpreadsheetApp.flush();

    return { ok: true, config: cfg };
  });
}

// Простейшая проверка ссылки: http:// или https:// и что-то после протокола.
function isHttpUrl_(text) {
  return /^https?:\/\/\S+$/i.test(String(text ?? '').trim());
}

// Ссылка для хранения: пустая строка, готовый http(s)-адрес либо адрес без протокола
// («example.com/page»), к которому добавляется https://. Всё остальное — null (ошибка).
function normalizeUrl_(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  if (isHttpUrl_(s)) return s;
  if (/^[^\s@\/:]+(\.[^\s@\/:]+)+(:\d+)?([\/?#]\S*)?$/.test(s) && /\.[A-Za-z]{2,}(?=[:\/?#]|$)/.test(s)) {
    return 'https://' + s;
  }
  return null;
}

function colLetters_(col) {
  let n = col;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellA1_(row, col) {
  return colLetters_(col) + row;
}

const URL_RULE_MARK = 'http://*';

function urlRuleFormula_(row, col) {
  return 'COUNTIF(' + cellA1_(row, col) + ',{"http://*";"https://*"})';
}

function isUrlCondition_(criteria, values) {
  return criteria === SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA &&
    String((values || [])[0] ?? '').indexOf(URL_RULE_MARK) !== -1;
}

function isUrlValidation_(rule) {
  return !!rule &&
    rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CUSTOM_FORMULA &&
    String((rule.getCriteriaValues() || [])[0] ?? '').indexOf(URL_RULE_MARK) !== -1;
}

// Условное форматирование, которое приложение ставит на столбец-ссылку (красная подсветка не-ссылок).
function isUrlHighlightOnColumn_(rule, col) {
  const cond = rule.getBooleanCondition();
  if (!cond || !isUrlCondition_(cond.getCriteriaType(), cond.getCriteriaValues())) return false;
  const ranges = rule.getRanges();
  return ranges.length > 0 && ranges.every(r => r.getColumn() <= col && col < r.getColumn() + r.getNumColumns());
}

function removeUrlHighlight_(sheet, col) {
  const rules = sheet.getConditionalFormatRules();
  const keep = rules.filter(r => !isUrlHighlightOnColumn_(r, col));
  if (keep.length !== rules.length) sheet.setConditionalFormatRules(keep);
}

/**
 * Приводит столбец к одному типу: убирает проверку данных, подсветку и формат
 * прежнего типа, затем ставит оформление нового. Значения не удаляются:
 *  • в «Дату» переводится только текст вида дд.мм.гггг / гггг-мм-дд, остальное остаётся текстом;
 *  • из «Даты» настоящие даты записываются текстом дд.мм.гггг;
 *  • в «Список» попадают значения, уже лежащие в столбце, плюс options;
 *  • ячейки с формулами не трогаются.
 */
function applyColumnType_(sheet, col, type, options, tz) {
  if (!PROP_TYPES.includes(type)) throw new Error('Неизвестный тип свойства.');

  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  const body = sheet.getRange(2, col, rows, 1);
  const dataRows = sheet.getLastRow() >= 2 ? sheet.getLastRow() - 1 : 0;

  // 1. Что нужно переписать — решаем до смены формата: потом тип значений уже не определить.
  const rewrites = [];   // [номер строки, значение]
  const texts = [];      // отображаемый текст для значений списка

  if (dataRows) {
    const range = sheet.getRange(2, col, dataRows, 1);
    const raw = range.getValues();
    const shown = range.getDisplayValues();
    const formulas = range.getFormulas();

    raw.forEach((r, i) => {
      const value = r[0];
      let text = String(shown[i][0] ?? '').trim();

      if (!formulas[i][0]) {
        if (type === 'date') {
          const iso = typeof value === 'string' ? parseDateText_(value) : '';
          if (iso) rewrites.push([i + 2, Utilities.parseDate(iso, tz, 'yyyy-MM-dd')]);
        } else if (isRealDate_(value)) {
          text = Utilities.formatDate(value, tz, DATE_FORMAT);
          rewrites.push([i + 2, text]);
        }
      }

      if (text) texts.push(text);
    });
  }

  // 2. Снимаем всё, что осталось от прежнего типа.
  body.clearDataValidations();
  removeUrlHighlight_(sheet, col);

  // 3. Формат: дата — датой, остальные типы — обычным текстом (текст не превращается в даты и числа).
  body.setNumberFormat(type === 'date' ? DATE_FORMAT : '@');

  // 4. Переписываем значения подряд идущими блоками.
  let i = 0;
  while (i < rewrites.length) {
    let j = i;
    while (j + 1 < rewrites.length && rewrites[j + 1][0] === rewrites[j][0] + 1) j++;
    sheet.getRange(rewrites[i][0], col, j - i + 1, 1)
      .setValues(rewrites.slice(i, j + 1).map(r => [r[1]]));
    i = j + 1;
  }

  // 5. Оформление нового типа.
  if (type === 'select') {
    const list = [...new Set([
      ...cleanList_(options, MAX_PROP_OPTIONS, 120).map(v => v.trim()).filter(Boolean),
      ...texts
    ])].slice(0, MAX_PROP_OPTIONS);

    // Значения списка живут в самой таблице, как у остальных выпадающих полей.
    if (list.length) {
      body.setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build()
      );
    }
  } else if (type === 'url') {
    // Ссылка: проверка формата в таблице (мягкая, значения не отвергаются) и подсветка не-ссылок.
    const first = urlRuleFormula_(2, col);

    try {
      body.setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireFormulaSatisfied('OR(ISBLANK(' + cellA1_(2, col) + '),' + first + '>0)')
          .setAllowInvalid(true)
          .build()
      );
    } catch (e) { /* проверка в таблице не критична: приложение проверяет ссылку само */ }

    try {
      const rule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('AND(' + cellA1_(2, col) + '<>"",' + first + '=0)')
        .setBackground('#F6C7C0')
        .setRanges([body])
        .build();
      sheet.setConditionalFormatRules([...sheet.getConditionalFormatRules(), rule]);
    } catch (e) { /* оформление не критично */ }
  }
}

// Тип каждого пользовательского столбца «как сейчас»: из настроек, а если там нет —
// как его определяет доска (список по правилу таблицы, дата по значениям, иначе текст).
function effectiveCustomTypes_(sheet, schema, cfg) {
  const rules = readRules_(sheet, schema.lastCol);
  const lastRow = sheet.getLastRow();
  const out = {};

  schema.props.forEach(p => {
    if (p.builtin) return;
    if (cfg.types[p.key]) { out[p.key] = cfg.types[p.key]; return; }
    if (optionsFromRule_(rules[p.col])) { out[p.key] = 'select'; return; }

    let isDate = false;
    if (lastRow >= 2) {
      const values = sheet.getRange(2, p.col, lastRow - 1, 1).getValues()
        .map(r => r[0]).filter(v => v !== '' && v != null);
      isDate = values.length > 0 && values.every(isRealDate_);
    }
    out[p.key] = isDate ? 'date' : 'text';
  });

  return out;
}

// Столбцы, у которых оформление в таблице не совпадает с типом свойства
// (остатки списка, проверки ссылки, формата даты). Только чтение.
function columnMismatches_(sheet, schema, rules) {
  const out = {};
  const custom = schema.props.filter(p => !p.builtin && p.type);
  if (!custom.length) return out;

  const lastCol = schema.lastCol;
  const formats = sheet.getRange(2, 1, 1, lastCol).getNumberFormats()[0];
  const highlighted = {};

  try {
    sheet.getConditionalFormatRules().forEach(rule => {
      custom.forEach(p => { if (isUrlHighlightOnColumn_(rule, p.col)) highlighted[p.col] = true; });
    });
  } catch (e) { /* не критично */ }

  custom.forEach(p => {
    const rule = rules[p.col];
    const criteria = rule ? rule.getCriteriaType() : null;
    const DVC = SpreadsheetApp.DataValidationCriteria;
    const hasList = criteria === DVC.VALUE_IN_LIST || criteria === DVC.VALUE_IN_RANGE;
    const hasUrl = isUrlValidation_(rule) || !!highlighted[p.col];
    const dateFormat = /[dMy]/.test(String(formats[p.col - 1] || ''));

    let bad = false;
    if (p.type === 'select') bad = hasUrl || dateFormat;
    else if (p.type === 'url') bad = hasList || dateFormat;
    else if (p.type === 'date') bad = hasList || hasUrl || !dateFormat;
    else bad = hasList || hasUrl || dateFormat;

    if (bad) out[p.key] = true;
  });

  return out;
}

/**
 * Добавляет в лист новый столбец-свойство. Существующие данные и столбцы
 * не меняются: новый столбец дописывается справа.
 * spec: { title, type: text|url|select|date, options: [для списка] }
 */
function createProperty(sheetId, spec) {
  const src = isPlainObject_(spec) ? spec : {};
  const title = String(src.title ?? '').trim().replace(/\s+/g, ' ');
  const type = String(src.type ?? 'text');

  if (!title) throw new Error('Введи название свойства.');
  if (title.length > MAX_PROP_TITLE) throw new Error('Название слишком длинное (до ' + MAX_PROP_TITLE + ' символов).');
  if (title.charAt(0) === '_') throw new Error('Название не может начинаться с «_»: такие столбцы считаются служебными.');
  if (!PROP_TYPES.includes(type)) throw new Error('Неизвестный тип свойства.');

  const options = type === 'select'
    ? [...new Set(cleanList_(src.options, MAX_PROP_OPTIONS, 120).map(v => v.trim()).filter(Boolean))]
    : [];

  return withLock_(() => {
    const sheet = getSheet_(sheetId);
    const before = buildSchema_(sheet);
    const cfg = readPropCfg_(sheet);
    const lastCol = sheet.getLastColumn();
    const wanted = normalize_(title);

    const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(normalize_);
    const taken = headers.includes(wanted) ||
      before.props.some(p => normalize_(cfg.titles[p.key] || p.title) === wanted);
    if (taken) throw new Error('Свойство «' + title + '» уже есть.');

    const col = lastCol + 1;
    if (col > sheet.getMaxColumns()) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), col - sheet.getMaxColumns());
    }

    const head = sheet.getRange(1, col);
    head.setValue(title);
    try {
      sheet.getRange(1, 1).copyTo(head, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    } catch (e) { /* оформление заголовка не критично */ }

    applyColumnType_(sheet, col, type, options, tzOf_(sheet));

    SpreadsheetApp.flush();

    const prop = buildSchema_(sheet).props.find(p => p.col === col);
    if (!prop) throw new Error('Не удалось создать свойство. Проверь заголовок нового столбца в таблице.');

    if (!prop.builtin) {
      cfg.types[prop.key] = type;
      writePropCfg_(sheet, cfg);
    }

    return { ok: true, key: prop.key, title };
  });
}

/* ---------- Чтение доски ---------- */

function getBoardData(sheetId) {
  const sheet = getSheet_(sheetId);
  const tz = tzOf_(sheet);
  const schema = ensureIdColumn_(sheet, false);
  const cfg = readPropCfg_(sheet);
  applyPropCfgTypes_(schema, cfg);

  let body = readBody_(sheet);

  if (findRowsNeedingIds_(schema, body).length) {
    assignMissingIds_(sheet, schema);
    body = readBody_(sheet);
  }

  // Типы пользовательских столбцов и варианты списков.
  const rules = readRules_(sheet, schema.lastCol);
  const ruleOptions = {};

  schema.props.forEach(p => {
    ruleOptions[p.key] = optionsFromRule_(rules[p.col]);

    if (!p.type) {
      if (ruleOptions[p.key]) {
        p.type = 'select';
      } else {
        const col = body.raw.map(r => r[p.col - 1]).filter(v => v !== '' && v != null);
        p.type = col.length && col.every(isRealDate_) ? 'date' : 'text';
      }
    }
  });

  let mismatches = {};
  try { mismatches = columnMismatches_(sheet, schema, rules); } catch (e) { /* подсказка не критична */ }

  const tasks = [];

  body.raw.forEach((row, i) => {
    const task = {
      _id: String(row[schema.idCol - 1] || '').trim(),
      _row: i + 2
    };

    schema.props.forEach(p => {
      task[p.key] = serialize_(p, row[p.col - 1], body.disp[i][p.col - 1], tz);
    });

    if (String(task['задача']).trim()) tasks.push(task);
  });

  const dropdownOptions = {};

  schema.props.filter(p => p.type === 'select').forEach(p => {
    let list = ruleOptions[p.key];

    if (!list) {
      list = [...new Set(tasks.map(t => String(t[p.key] || '').trim()).filter(Boolean))];
    }

    // Значения, добавленные из интерфейса, дополняют правило таблицы.
    dropdownOptions[p.key] = [...new Set([...list, ...(cfg.options[p.key] || [])])];
  });

  // Статусы берутся из самой таблицы: правило столбца «Статус» (плюс значения, добавленные
  // из интерфейса) и статусы, которые реально встречаются в задачах. Зашитый список STATUSES
  // не подмешивается: столбцы канбана, которых нет в таблице, нельзя было бы сохранить.
  let statuses = [...new Set([
    ...(dropdownOptions['статус'] || []),
    ...tasks.map(t => String(t['статус'] || '').trim()).filter(Boolean)
  ])];

  // Лист без правила и без задач: показать иначе нечего, а писать в него можно любой текст.
  if (!statuses.length) statuses = STATUSES.slice();

  dropdownOptions['статус'] = statuses;

  SORTED_SELECTS.forEach(key => {
    if (dropdownOptions[key]) {
      dropdownOptions[key] = [...new Set(dropdownOptions[key])]
        .sort((a, b) => a.localeCompare(b, 'ru'));
    }
  });

  return {
    sheetId: sheet.getSheetId(),
    sheetName: sheet.getName(),
    schema: orderProps_(schema.props, cfg.order).map(p => ({
      key: p.key,
      title: cfg.titles[p.key] || p.title,
      sourceTitle: p.title,
      type: p.type,
      builtin: p.builtin,
      hidden: cfg.hidden.includes(p.key),
      mismatch: !!mismatches[p.key]
    })),
    tasks,
    statuses,
    dropdownOptions,
    colors: readColors_(sheet),
    views: readViews_(sheet),
    propConfig: cfg
  };
}

/* ---------- Запись ---------- */

function writeCell_(sheet, row, prop, value, tz) {
  const range = sheet.getRange(row, prop.col);
  const text = value == null ? '' : value;

  if (prop.type === 'date') {
    const s = String(text).trim();

    if (!s) {
      range.clearContent();
      return;
    }

    const iso = parseDateText_(s);

    if (iso) {
      // Настоящая дата в часовом поясе таблицы: день не сдвигается.
      if (!/[dMy]/.test(range.getNumberFormat())) range.setNumberFormat(DATE_FORMAT);
      range.setValue(Utilities.parseDate(iso, tz, 'yyyy-MM-dd'));
      return;
    }

    range.setValue(s);
    return;
  }

  range.setValue(text);
}

/**
 * Сохраняет только изменённые поля задачи.
 * changes — новые значения, base — значения, которые клиент считал
 * актуальными. Если в таблице поле успели изменить, оно не перезаписывается,
 * а возвращается в conflicts.
 */
function saveTask(sheetId, id, changes, base) {
  return withLock_(() => {
    const sheet = getSheet_(sheetId);
    const tz = tzOf_(sheet);
    const schema = buildSchema_(sheet);

    if (!schema.idCol) {
      throw new Error('Не найден столбец идентификаторов. Обнови доску.');
    }

    const row = findRowById_(sheet, schema.idCol, id);
    if (!row) {
      throw new Error('Задача не найдена: возможно, её удалили из таблицы. Обнови доску.');
    }

    resolveCustomTypes_(sheet, schema);

    // Ссылки проверяются до записи: частично сохранённое изменение хуже отказа.
    changes = Object.assign({}, changes);
    Object.keys(changes).forEach(key => {
      const prop = schema.byKey[key];
      if (!prop || prop.type !== 'url') return;

      const url = normalizeUrl_(changes[key]);
      if (url === null) {
        throw new Error('«' + (prop.title || key) + '»: ссылка должна начинаться с http:// или https://');
      }
      changes[key] = url;
    });

    const current = readRowValues_(sheet, row, schema, tz);
    const written = [];
    const conflicts = {};
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

    // Значения списков проверяются по правилам таблицы до записи, как и ссылки выше.
    Object.keys(changes).forEach(key => {
      const prop = schema.byKey[key];
      if (!prop || !isRuleChecked_(prop)) return;
      if (String(changes[key] ?? '') === String(current[key] ?? '')) return;
      validateAgainstRule_(sheet, row, prop, changes[key]);
    });

    Object.keys(changes || {}).forEach(key => {
      const prop = schema.byKey[key];
      if (!prop || prop.type === 'id') return;

      const rich = LONGTEXT_FIELDS.includes(key);
      let next = String(changes[key] ?? '');
      const cur = String(current[key] ?? '');

      if (rich) {
        next = normalizeRich_(next);
        checkCellLength_(next);
      }

      if (key === 'задача' && !next.trim()) {
        throw new Error('Название не может быть пустым.');
      }

      if (next === cur || (rich && next === normalizeRich_(cur))) return;

      if (has(base, key) && String(base[key] ?? '') !== cur) {
        conflicts[key] = cur;
        return;
      }

      writeCell_(sheet, row, prop, next, tz);
      written.push(key);
    });

    SpreadsheetApp.flush();

    const after = readRowValues_(sheet, row, schema, tz);
    const values = {};
    Object.keys(changes || {}).forEach(key => {
      if (has(after, key) && !has(conflicts, key)) values[key] = after[key];
    });

    return { ok: true, values, conflicts };
  });
}

// Совместимость: смена статуса при перетаскивании.
function updateTaskStatus(sheetId, id, newStatus, oldStatus) {
  return saveTask(sheetId, id, { 'статус': newStatus }, { 'статус': oldStatus });
}

/**
 * Создаёт задачу. requestId защищает от дублей: повторная отправка
 * того же запроса вернёт уже созданную задачу.
 */
function createTask(sheetId, data, requestId) {
  if (!data || !String(data['задача'] || '').trim()) {
    throw new Error('Заполни название задачи.');
  }

  return withLock_(() => {
    const cache = CacheService.getScriptCache();
    const cacheKey = requestId ? 'req:' + requestId : '';

    if (cacheKey) {
      const hit = cache.get(cacheKey);
      if (hit) return JSON.parse(hit);
    }

    const sheet = getSheet_(sheetId);
    const tz = tzOf_(sheet);
    const schema = ensureIdColumn_(sheet, true);
    resolveCustomTypes_(sheet, schema);

    const lastCol = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();
    const numberProp = schema.byKey['номер'];
    let nextNumber = 1;

    if (numberProp && lastRow >= 2) {
      const numeric = sheet.getRange(2, numberProp.col, lastRow - 1, 1)
        .getDisplayValues().flat()
        .map(v => String(v).trim())
        .filter(Boolean)
        .map(Number)
        .filter(v => Number.isFinite(v) && v >= 0);

      if (numeric.length) nextNumber = Math.max(...numeric) + 1;
    }

    const row = Math.max(lastRow + 1, 2);
    const id = newId_();
    const values = Array(lastCol).fill('');
    const dateCells = [];

    // Статус по умолчанию: «Не залито», если таблица его допускает, иначе первый разрешённый.
    let defaultStatus = 'Не залито';
    const statusProp = schema.byKey['статус'];
    if (statusProp && row <= sheet.getMaxRows()) {
      try {
        const statusRule = sheet.getRange(row, statusProp.col).getDataValidation();
        const allowed = statusRule ? optionsFromRule_(statusRule) : null;
        if (allowed && allowed.length && !allowed.includes(defaultStatus)) defaultStatus = allowed[0];
      } catch (e) { /* без правила остаётся значение по умолчанию */ }
    }

    schema.props.forEach(p => {
      let value = data[p.key] == null ? '' : data[p.key];

      if (p.type === 'id') {
        value = String(value).trim() || String(nextNumber);
      } else if (p.key === 'задача') {
        value = String(value).trim();
      } else if (p.key === 'статус' && !value) {
        value = defaultStatus;
      } else if (LONGTEXT_FIELDS.includes(p.key)) {
        value = normalizeRich_(value);
        checkCellLength_(value);
      } else if (p.type === 'url') {
        const url = normalizeUrl_(value);
        if (url === null) {
          throw new Error('«' + (p.title || p.key) + '»: ссылка должна начинаться с http:// или https://');
        }
        value = url;
      } else if (p.type === 'date') {
        const iso = parseDateText_(value);
        if (iso) {
          value = Utilities.parseDate(iso, tz, 'yyyy-MM-dd');
          dateCells.push(p.col);
        }
      }

      // Значение, которое таблица не примет, отклоняется понятной ошибкой до записи.
      if (isRuleChecked_(p)) validateAgainstRule_(sheet, row, p, value);

      values[p.col - 1] = value;
    });

    values[schema.idCol - 1] = id;

    sheet.getRange(row, 1, 1, lastCol).setValues([values]);

    dateCells.forEach(col => {
      const cell = sheet.getRange(row, col);
      if (!/[dMy]/.test(cell.getNumberFormat())) cell.setNumberFormat(DATE_FORMAT);
    });

    SpreadsheetApp.flush();

    const result = {
      ok: true,
      id,
      row,
      number: numberProp ? String(values[numberProp.col - 1]) : String(row),
      values: readRowValues_(sheet, row, schema, tz)
    };

    if (cacheKey) cache.put(cacheKey, JSON.stringify(result), 600);

    return result;
  });
}
/* ---------- Этап 5: рабочая область, доски и базы знаний ---------- */

const WORKSPACE_VERSION = 1;
const WORKSPACE_KEY_PREFIX = 'qaflow.workspace.';

const BOARD_HEADERS = [
  'Номер',
  'Задача',
  'Статус',
  'Исполнитель',
  'Разраб',
  'Дата выкатки',
  'Категория',
  'Флоу',
  'Версия',
  'Коммент'
];

const KNOWLEDGE_HEADERS = [
  '_id',
  'Заголовок',
  'Содержание',
  'Метки',
  'Обновлено'
];

const KNOWLEDGE_COLS = {
  id: 1,
  title: 2,
  content: 3,
  labels: 4,
  updated: 5
};

const MAX_KNOWLEDGE_TITLE = 300;
const MAX_KNOWLEDGE_LABELS = 200;

function workspaceKey_() {
  return WORKSPACE_KEY_PREFIX + CONFIG.SPREADSHEET_ID;
}

function readWorkspace_() {
  const raw = PropertiesService.getScriptProperties().getProperty(workspaceKey_());
  if (!raw) return { version: WORKSPACE_VERSION, boards: [], knowledge: [], migrated: false };
  try {
    const parsed = JSON.parse(raw);
    return normalizeWorkspace_(parsed);
  } catch (e) {
    return { version: WORKSPACE_VERSION, boards: [], knowledge: [], migrated: false };
  }
}

function writeWorkspace_(ws) {
  PropertiesService.getScriptProperties().setProperty(workspaceKey_(), JSON.stringify(ws));
}

function sanitizeWorkspaceItem_(raw) {
  if (!isPlainObject_(raw)) return null;
  const id = Number(raw.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    name: String(raw.name ?? '').trim().slice(0, 100) || 'Без названия',
    archived: raw.archived === true,
    createdByApp: raw.createdByApp === true,
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now()
  };
}

function normalizeWorkspace_(raw) {
  const src = isPlainObject_(raw) ? raw : {};
  const ws = {
    version: WORKSPACE_VERSION,
    boards: [],
    knowledge: [],
    migrated: src.migrated === true
  };

  ['boards', 'knowledge'].forEach(type => {
    if (!Array.isArray(src[type])) return;
    src[type].forEach(item => {
      const clean = sanitizeWorkspaceItem_(item);
      if (clean && !ws[type].some(x => x.id === clean.id)) ws[type].push(clean);
    });
  });

  return ws;
}

function findWorkspaceItem_(ws, id) {
  const sid = Number(id);
  for (const type of ['boards', 'knowledge']) {
    const index = ws[type].findIndex(item => item.id === sid);
    if (index !== -1) return { type, item: ws[type][index], index };
  }
  return null;
}

function uniqueSheetName_(ss, base, ignoreId) {
  const names = ss.getSheets()
    .filter(s => s.getSheetId() !== Number(ignoreId))
    .map(s => s.getName());

  let name = String(base ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!name) name = 'Без названия';
  if (!names.includes(name)) return name;

  let n = 2;
  while (names.includes(name + ' ' + n)) n++;
  return name + ' ' + n;
}

function setupBoardSheet_(sheet) {
  sheet.getRange(1, 1, 1, BOARD_HEADERS.length).setValues([BOARD_HEADERS]);
  sheet.getRange(1, 1, 1, BOARD_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  const statusCol = BOARD_HEADERS.indexOf('Статус') + 1;
  if (statusCol > 0) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(STATUSES, true)
      .build();
    const rows = Math.max(sheet.getMaxRows() - 1, 1);
    sheet.getRange(2, statusCol, rows, 1).setDataValidation(rule);
  }
}

function setupKnowledgeSheet_(sheet) {
  sheet.getRange(1, 1, 1, KNOWLEDGE_HEADERS.length).setValues([KNOWLEDGE_HEADERS]);
  sheet.getRange(1, 1, 1, KNOWLEDGE_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  try { sheet.hideColumns(KNOWLEDGE_COLS.id); } catch (e) { /* не критично */ }
}

function ensureRows_(sheet, row) {
  const max = sheet.getMaxRows();
  if (row > max) sheet.insertRowsAfter(max, row - max);
}

// Лист базы знаний узнаётся по фактической структуре: заголовки совпадают с KNOWLEDGE_HEADERS.
function isKnowledgeSheet_(sheet) {
  try {
    if (sheet.getLastColumn() < KNOWLEDGE_HEADERS.length) return false;
    const headers = sheet.getRange(1, 1, 1, KNOWLEDGE_HEADERS.length).getDisplayValues()[0];
    return headers.join('|') === KNOWLEDGE_HEADERS.join('|');
  } catch (e) {
    return false;
  }
}

function migrateWorkspace_(ss) {
  const ws = {
    version: WORKSPACE_VERSION,
    boards: [],
    knowledge: [],
    migrated: true
  };

  ss.getSheets().forEach(sheet => {
    if (sheet.isSheetHidden()) return;
    const item = {
      id: sheet.getSheetId(),
      name: sheet.getName(),
      archived: false,
      createdByApp: false,
      createdAt: Date.now()
    };
    // Если список в свойствах скрипта потерян, базы знаний не должны стать досками.
    if (isKnowledgeSheet_(sheet)) ws.knowledge.push(item);
    else ws.boards.push(item);
  });

  if (!ws.boards.length) {
    const sheet = ss.insertSheet('Основная доска');
    setupBoardSheet_(sheet);
    ws.boards.push({
      id: sheet.getSheetId(),
      name: sheet.getName(),
      archived: false,
      createdByApp: true,
      createdAt: Date.now()
    });
  }

  return ws;
}

function syncWorkspaceWithSheets_(ss, ws) {
  const sheets = ss.getSheets();
  const map = {};
  sheets.forEach(sheet => {
    map[sheet.getSheetId()] = sheet.getName();
  });

  let changed = false;
  const seen = {};

  // Убираем удалённые листы, обновляем названия и не допускаем один лист в двух списках.
  ['boards', 'knowledge'].forEach(type => {
    const kept = [];
    ws[type].forEach(item => {
      const name = map[item.id];
      if (name === undefined || seen[item.id]) {
        changed = true;
        return;
      }
      seen[item.id] = true;
      if (item.name !== name) {
        item.name = name;
        changed = true;
      }
      kept.push(item);
    });
    ws[type] = kept;
  });

  // Листы, добавленные в таблицу напрямую, раньше в список не попадали.
  // Подхватываем видимые листы, которых ещё нет ни среди досок, ни среди баз знаний.
  sheets.forEach(sheet => {
    const id = sheet.getSheetId();
    if (seen[id] || sheet.isSheetHidden()) return;
    seen[id] = true;
    const item = {
      id,
      name: sheet.getName(),
      archived: false,
      createdByApp: false,
      createdAt: Date.now()
    };
    if (isKnowledgeSheet_(sheet)) ws.knowledge.push(item);
    else ws.boards.push(item);
    changed = true;
  });

  return changed;
}

function getWorkspace() {
  return withLock_(() => {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    let ws = readWorkspace_();

    if (!ws.migrated) {
      ws = migrateWorkspace_(ss);
      writeWorkspace_(ws);
      return ws;
    }

    if (syncWorkspaceWithSheets_(ss, ws)) {
      writeWorkspace_(ws);
    }

    return ws;
  });
}

function createBoard(name) {
  return withLock_(() => {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheetName = uniqueSheetName_(ss, name || 'Доска');
    const sheet = ss.insertSheet(sheetName);
    setupBoardSheet_(sheet);

    const ws = readWorkspace_();
    ws.boards.push({
      id: sheet.getSheetId(),
      name: sheetName,
      archived: false,
      createdByApp: true,
      createdAt: Date.now()
    });
    writeWorkspace_(ws);

    return { ok: true, id: sheet.getSheetId(), workspace: ws };
  });
}

function createKnowledge(name) {
  return withLock_(() => {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheetName = uniqueSheetName_(ss, name || 'База знаний');
    const sheet = ss.insertSheet(sheetName);
    setupKnowledgeSheet_(sheet);

    const ws = readWorkspace_();
    ws.knowledge.push({
      id: sheet.getSheetId(),
      name: sheetName,
      archived: false,
      createdByApp: true,
      createdAt: Date.now()
    });
    writeWorkspace_(ws);

    return { ok: true, id: sheet.getSheetId(), workspace: ws };
  });
}

function renameWorkspaceItem(id, name) {
  return withLock_(() => {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const ws = readWorkspace_();
    const found = findWorkspaceItem_(ws, id);
    if (!found) throw new Error('Элемент не найден.');

    const sheet = ss.getSheets().find(s => s.getSheetId() === Number(id));
    if (!sheet) throw new Error('Лист не найден.');

    const newName = uniqueSheetName_(ss, name, id);
    sheet.setName(newName);
    found.item.name = newName;
    writeWorkspace_(ws);

    return { ok: true, workspace: ws };
  });
}

function setWorkspaceArchived(id, archived) {
  return withLock_(() => {
    const ws = readWorkspace_();
    const found = findWorkspaceItem_(ws, id);
    if (!found) throw new Error('Элемент не найден.');

    found.item.archived = archived === true;
    writeWorkspace_(ws);

    return { ok: true, workspace: ws };
  });
}

function deleteWorkspaceItem(id) {
  return withLock_(() => {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const ws = readWorkspace_();
    const found = findWorkspaceItem_(ws, id);
    if (!found) throw new Error('Элемент не найден.');
    if (!found.item.createdByApp) {
      throw new Error('Удалять можно только доски и базы знаний, созданные в приложении.');
    }

    const sheet = ss.getSheets().find(s => s.getSheetId() === Number(id));
    if (sheet) ss.deleteSheet(sheet);

    ws[found.type].splice(found.index, 1);
    writeWorkspace_(ws);

    return { ok: true, workspace: ws };
  });
}

/* ---------- Базы знаний: данные статей ---------- */

function ensureKnowledgeSheet_(sheet) {
  if (sheet.getLastColumn() >= KNOWLEDGE_HEADERS.length) {
    const headers = sheet.getRange(1, 1, 1, KNOWLEDGE_HEADERS.length).getDisplayValues()[0];
    if (headers.join('|') === KNOWLEDGE_HEADERS.join('|')) return;
  }

  // Пустой лист можно привести к структуре базы знаний.
  if (sheet.getLastRow() <= 1 && sheet.getLastColumn() <= 1) {
    setupKnowledgeSheet_(sheet);
    return;
  }

  throw new Error('Лист базы знаний имеет неверную структуру.');
}

function findKnowledgeRow_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (!id || lastRow < 2) return 0;
  const ids = sheet.getRange(2, KNOWLEDGE_COLS.id, lastRow - 1, 1)
    .getValues()
    .map(r => String(r[0] ?? '').trim());
  const index = ids.indexOf(String(id).trim());
  return index === -1 ? 0 : index + 2;
}

function readKnowledgeRow_(sheet, row) {
  const values = sheet.getRange(row, 1, 1, KNOWLEDGE_HEADERS.length).getValues()[0];
  return {
    _id: String(values[KNOWLEDGE_COLS.id - 1] ?? '').trim(),
    _row: row,
    title: String(values[KNOWLEDGE_COLS.title - 1] ?? ''),
    content: String(values[KNOWLEDGE_COLS.content - 1] ?? ''),
    labels: String(values[KNOWLEDGE_COLS.labels - 1] ?? ''),
    updated: String(values[KNOWLEDGE_COLS.updated - 1] ?? '')
  };
}

function getKnowledgeData(sectionId) {
  return withLock_(() => {
    const sheet = getSheet_(sectionId);
    ensureKnowledgeSheet_(sheet);

    const lastRow = sheet.getLastRow();

    // Выдаём ID строкам без ID.
    if (lastRow >= 2) {
      const range = sheet.getRange(2, KNOWLEDGE_COLS.id, lastRow - 1, 1);
      const ids = range.getValues();
      const titles = sheet.getRange(2, KNOWLEDGE_COLS.title, lastRow - 1, 1).getDisplayValues();
      let changed = false;

      ids.forEach((row, i) => {
        const id = String(row[0] ?? '').trim();
        const title = String(titles[i][0] ?? '').trim();
        if (title && !id) {
          row[0] = newId_();
          changed = true;
        }
      });

      if (changed) {
        range.setValues(ids);
        SpreadsheetApp.flush();
      }
    }

    const values = lastRow >= 2
      ? sheet.getRange(2, 1, lastRow - 1, KNOWLEDGE_HEADERS.length).getValues()
      : [];

    const articles = values.map((row, i) => ({
      _id: String(row[KNOWLEDGE_COLS.id - 1] ?? '').trim(),
      _row: i + 2,
      title: String(row[KNOWLEDGE_COLS.title - 1] ?? '').trim(),
      content: String(row[KNOWLEDGE_COLS.content - 1] ?? ''),
      labels: String(row[KNOWLEDGE_COLS.labels - 1] ?? ''),
      updated: String(row[KNOWLEDGE_COLS.updated - 1] ?? '')
    })).filter(a => a.title);

    return {
      sectionId: sheet.getSheetId(),
      sectionName: sheet.getName(),
      articles
    };
  });
}

function createKnowledgeArticle(sectionId, data, requestId) {
  if (!data || !String(data.title ?? '').trim()) {
    throw new Error('Заполни заголовок статьи.');
  }

  return withLock_(() => {
    const cache = CacheService.getScriptCache();
    const cacheKey = requestId ? 'knreq:' + requestId : '';
    if (cacheKey) {
      const hit = cache.get(cacheKey);
      if (hit) return JSON.parse(hit);
    }

    const sheet = getSheet_(sectionId);
    ensureKnowledgeSheet_(sheet);
    const tz = tzOf_(sheet);

    const row = Math.max(sheet.getLastRow() + 1, 2);
    ensureRows_(sheet, row);

    const id = newId_();
    const title = String(data.title ?? '').trim().slice(0, MAX_KNOWLEDGE_TITLE);
    const content = normalizeRich_(data.content ?? '');
    checkCellLength_(content);
    const labels = String(data.labels ?? '').trim().slice(0, MAX_KNOWLEDGE_LABELS);
    const updated = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    sheet.getRange(row, 1, 1, KNOWLEDGE_HEADERS.length)
      .setValues([[id, title, content, labels, updated]]);
    SpreadsheetApp.flush();

    const article = { _id: id, _row: row, title, content, labels, updated };
    const result = { ok: true, article };

    if (cacheKey) cache.put(cacheKey, JSON.stringify(result), 600);
    return result;
  });
}

function saveKnowledgeArticle(sectionId, id, changes, base) {
  return withLock_(() => {
    const sheet = getSheet_(sectionId);
    ensureKnowledgeSheet_(sheet);
    const tz = tzOf_(sheet);

    const row = findKnowledgeRow_(sheet, id);
    if (!row) throw new Error('Статья не найдена.');

    const current = readKnowledgeRow_(sheet, row);
    const conflicts = {};
    const written = {};
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

    Object.keys(changes || {}).forEach(key => {
      if (!KNOWLEDGE_COLS[key] || key === 'id' || key === 'updated') return;

      let next = String(changes[key] ?? '');
      if (key === 'title') {
        next = next.trim().slice(0, MAX_KNOWLEDGE_TITLE);
        if (!next) throw new Error('Заголовок не может быть пустым.');
      }
      if (key === 'content') {
        next = normalizeRich_(next);
        checkCellLength_(next);
      }
      if (key === 'labels') {
        next = next.trim().slice(0, MAX_KNOWLEDGE_LABELS);
      }

      const cur = String(current[key] ?? '');
      if (next === cur) return;

      if (has(base, key) && String(base[key] ?? '') !== cur) {
        conflicts[key] = cur;
        return;
      }

      sheet.getRange(row, KNOWLEDGE_COLS[key]).setValue(next);
      written[key] = next;
    });

    if (Object.keys(written).length) {
      const updated = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');
      sheet.getRange(row, KNOWLEDGE_COLS.updated).setValue(updated);
      written.updated = updated;
    }

    SpreadsheetApp.flush();
    const after = readKnowledgeRow_(sheet, row);

    return { ok: true, values: after, conflicts };
  });
}

/* ---------- Новый статус и значения списков в самой таблице (п. 6 ТЗ) ---------- */

// Список статусов приложение читает из правила проверки данных столбца «Статус»
// (см. getBoardData). Поэтому новый статус добавляется именно в это правило:
// так таблица сразу его разрешает, и карточку в новом столбце можно создать и сохранить.
// Раньше значения, добавленные из интерфейса, хранились только в настройках свойств
// (cfg.options), а таблица их не знала и отклоняла карточку с таким статусом.
//
// Если у столбца нет правила-списка, значения по-прежнему живут в настройках свойств.
// Файл самодостаточный: Code.gs менять не нужно, функции используют его помощники.

const MAX_STATUS_LENGTH = 120;

/**
 * Добавляет значения в правило-список столбца (VALUE_IN_LIST или VALUE_IN_RANGE).
 * Остальные параметры правила (разрешение прочих значений, подсказка) сохраняются.
 * Возвращает true, если правило обновлено или нужные значения в нём уже есть;
 * false — если у столбца нет правила такого вида.
 */
function extendListRule_(sheet, col, rule, values) {
  if (!rule) return false;

  const DVC = SpreadsheetApp.DataValidationCriteria;
  const criteria = rule.getCriteriaType();
  const args = rule.getCriteriaValues();
  const showDropdown = args[1] !== false;
  const body = sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1);
  let builder;

  if (criteria === DVC.VALUE_IN_LIST) {
    const list = (args[0] || []).map(v => String(v).trim()).filter(Boolean);
    const have = new Set(list.map(normalize_));
    const add = values.filter(v => !have.has(normalize_(v)));
    if (!add.length) return true;
    builder = rule.copy().requireValueInList(list.concat(add), showDropdown);
  } else if (criteria === DVC.VALUE_IN_RANGE) {
    const src = args[0];
    const have = new Set(src.getDisplayValues().flat().map(v => normalize_(v)));
    const add = values.filter(v => !have.has(normalize_(v)));
    if (!add.length) return true;

    if (src.getNumColumns() !== 1) {
      throw new Error('Список значений в таблице занимает несколько столбцов. Добавь значение в него вручную.');
    }

    // Источник списка расширяем вниз: новые значения пишутся сразу под ним.
    const srcSheet = src.getSheet();
    const startRow = src.getRow() + src.getNumRows();
    ensureRows_(srcSheet, startRow + add.length - 1);

    const below = srcSheet.getRange(startRow, src.getColumn(), add.length, 1);
    if (below.getValues().some(r => String(r[0] ?? '').trim() !== '')) {
      throw new Error('Не удалось добавить значение в список таблицы: под ним есть другие данные. Добавь значение в список вручную.');
    }

    below.setValues(add.map(v => [v]));
    const extended = srcSheet.getRange(src.getRow(), src.getColumn(), src.getNumRows() + add.length, 1);
    builder = rule.copy().requireValueInRange(extended, showDropdown);
  } else {
    return false;
  }

  body.setDataValidation(builder.build());
  return true;
}

/**
 * Переносит значения списков из настроек свойств (cfg.options) в правила таблицы.
 * Перенесённые значения из cfg.options удаляются: источник списка один — таблица.
 * onlyKeys — только эти свойства; skipKeys — { ключ: true } пропустить.
 * Возвращает true, если cfg изменился (его нужно записать).
 */
function moveOptionsToRules_(sheet, schema, cfg, onlyKeys, skipKeys) {
  const rules = readRules_(sheet, schema.lastCol);
  let changed = false;

  Object.keys(cfg.options).forEach(key => {
    if (onlyKeys && !onlyKeys.includes(key)) return;
    if (skipKeys && skipKeys[key]) return;

    const prop = schema.byKey[key];
    const rule = prop ? rules[prop.col] : null;
    const inRule = optionsFromRule_(rule);
    if (!inRule) return;   // правила-списка нет: значения остаются в настройках

    const have = new Set(inRule.map(normalize_));
    const add = cfg.options[key].filter(v => !have.has(normalize_(v)));

    if (add.length && !extendListRule_(sheet, prop.col, rule, add)) return;

    delete cfg.options[key];
    changed = true;
  });

  return changed;
}

/**
 * Создаёт статус, а вместе с ним столбец канбана. Свойство-столбец в таблице
 * не создаётся: статус — это новое допустимое значение столбца «Статус».
 * Карточки и порядок существующих статусов не затрагиваются.
 */
function createStatus(sheetId, name) {
  const title = String(name ?? '').trim().replace(/\s+/g, ' ');

  if (!title) throw new Error('Введи название статуса.');
  if (title.length > MAX_STATUS_LENGTH) {
    throw new Error('Название статуса слишком длинное (до ' + MAX_STATUS_LENGTH + ' символов).');
  }
  if (title.charAt(0) === '=') {
    throw new Error('Название статуса не может начинаться с «=»: таблица примет его за формулу.');
  }

  return withLock_(() => {
    const sheet = getSheet_(sheetId);
    const schema = buildSchema_(sheet);
    const prop = schema.byKey['статус'];
    const cfg = readPropCfg_(sheet);

    // Статусы, добавленные раньше только в настройки, переносим в правило таблицы:
    // иначе таблица продолжит отклонять карточки с ними.
    let cfgChanged = moveOptionsToRules_(sheet, schema, cfg, ['статус'], null);

    const rule = readRules_(sheet, schema.lastCol)[prop.col];
    const fromRule = optionsFromRule_(rule) || [];
    const lastRow = sheet.getLastRow();
    const used = lastRow >= 2
      ? sheet.getRange(2, prop.col, lastRow - 1, 1).getDisplayValues().flat()
      : [];

    const known = [
      ...fromRule,
      ...(cfg.options['статус'] || []),
      ...used.map(v => String(v).trim()).filter(Boolean)
    ];
    const wanted = normalize_(title);

    if (known.some(s => normalize_(s) === wanted)) {
      // Если статус уже был, но лежал только в настройках, он перенесён выше — сохраняем это.
      if (cfgChanged) writePropCfg_(sheet, cfg);
      throw new Error('Статус «' + title + '» уже есть.');
    }

    if (!extendListRule_(sheet, prop.col, rule, [title])) {
      // У столбца нет правила-списка: значения статусов хранятся в настройках свойств.
      const list = cfg.options['статус'] || [];
      if (list.length >= MAX_PROP_OPTIONS) {
        throw new Error('Слишком много добавленных статусов (не больше ' + MAX_PROP_OPTIONS + ').');
      }
      cfg.options['статус'] = list.concat(title);
      cfgChanged = true;
    }

    if (cfgChanged) writePropCfg_(sheet, cfg);
    SpreadsheetApp.flush();

    return { ok: true, status: title };
  });
}

/**
 * Переносит в правила таблицы все значения списков, добавленные из интерфейса.
 * Вызывается после сохранения окна «Свойства». Остальные настройки не меняются.
 */
function syncPropertyOptions(sheetId) {
  return withLock_(() => {
    const sheet = getSheet_(sheetId);
    const schema = buildSchema_(sheet);
    const cfg = readPropCfg_(sheet);

    if (!moveOptionsToRules_(sheet, schema, cfg, null, null)) return { ok: true, moved: false };

    writePropCfg_(sheet, cfg);
    SpreadsheetApp.flush();
    return { ok: true, moved: true };
  });
}