// Поддельная база в памяти: повторяет то, на что опирается приложение (триггеры, ограничения, правила удаления, RPC).
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const ME = { id: 'u-an', email: 'an@qaflow.test' };

const TABLES = ['members', 'boards', 'board_columns', 'properties', 'property_options', 'tasks', 'task_values', 'views', 'knowledge_bases', 'knowledge_articles'];
const db = { tables: Object.fromEntries(TABLES.map((t) => [t, []])), handlers: [], session: { user: ME }, authListeners: [], user: ME.id };
db.tables.members.push({ user_id: ME.id, display_name: 'Ан', role: 'admin', is_active: true });
db.tables.members.push({ user_id: 'u-anna', display_name: 'Анна', role: 'member', is_active: true });

const err = (code, message) => Object.assign(new Error(message), { code, message });
const stripTags = (h) => (h || '').replace(/<[^>]*>/g, ' ');

function notify(table, kind, row) {
  setTimeout(() => db.handlers.filter((h) => h.table === table).forEach((h) => h.cb({ eventType: kind, new: row, old: row })), 0);
}

// ---------------- правила вставки и изменения (аналог триггеров и ограничений)
function insertRow(table, input) {
  const row = { ...input };
  const t = db.tables;
  row.id ??= (table === 'task_values' || table === 'members') ? undefined : uid();
  if (row.id === undefined) delete row.id;
  const ts = now();
  switch (table) {
    case 'boards':
      if (!row.name || !row.name.trim()) throw err('23514', 'new row violates check constraint');
      Object.assign(row, { next_task_number: 1, archived_at: null, description: row.description ?? null, created_at: ts, updated_at: ts });
      break;
    case 'board_columns':
      Object.assign(row, { color: row.color ?? 'gray', archived_at: null, created_at: ts, updated_at: ts });
      break;
    case 'properties':
      if (!['select', 'text', 'url', 'date'].includes(row.type)) throw err('23514', 'check constraint');
      if (t.properties.some((p) => p.board_id === row.board_id && p.archived_at === null && p.name.trim().toLowerCase() === row.name.trim().toLowerCase()))
        throw err('23505', 'duplicate key value violates unique constraint "properties_name_uniq"');
      Object.assign(row, {
        multiple: row.type === 'select' ? (row.multiple ?? false) : false,
        hidden: row.hidden ?? false,
        archived_at: null,
        created_at: ts,
        updated_at: ts,
      });
      break;
    case 'property_options': {
      const p = t.properties.find((x) => x.id === row.property_id);
      if (!p || p.type !== 'select') throw err('23514', 'Варианты можно добавлять только к свойству типа «Выпадающий список»');
      if (t.property_options.some((o) => o.property_id === row.property_id && o.label.trim().toLowerCase() === row.label.trim().toLowerCase()))
        throw err('23505', 'duplicate key value violates unique constraint "property_options_label_uniq"');
      Object.assign(row, { color: row.color ?? 'gray', created_at: ts, updated_at: ts });
      break;
    }
    case 'tasks': {
      const board = t.boards.find((b) => b.id === row.board_id);
      if (!board) throw err('23503', 'Доска не найдена');
      const col = t.board_columns.find((c) => c.id === row.column_id && c.board_id === row.board_id);
      if (!col) throw err('23503', 'violates foreign key constraint');
      if (!row.title || !row.title.trim()) throw err('23514', 'check constraint');
      row.number = board.next_task_number++;
      Object.assign(row, { description_html: row.description_html ?? '', version: 1, archived_at: null, deleted_at: null, created_by: db.user, updated_by: null, created_at: ts, updated_at: ts });
      row.search_text = stripTags(row.description_html);
      break;
    }
    case 'task_values':
      validateValue(row);
      if (t.task_values.some((v) => v.task_id === row.task_id && v.property_id === row.property_id))
        throw err('23505', 'duplicate key value violates unique constraint "task_values_pkey"');
      Object.assign(row, {
        value_text: row.value_text ?? null,
        value_date: row.value_date ?? null,
        option_id: row.option_id ?? null,
        option_ids: row.option_ids ?? [],
        updated_at: ts,
      });
      break;
    case 'views':
      Object.assign(row, { owner_id: row.owner_id ?? null, config: row.config ?? {}, created_at: ts, updated_at: ts });
      break;
    case 'knowledge_bases':
      Object.assign(row, { archived_at: null, created_at: ts, updated_at: ts });
      break;
    case 'knowledge_articles':
      if (!row.title || !row.title.trim()) throw err('23514', 'check constraint');
      if ((row.labels || []).length > 20) throw err('23514', 'check constraint');
      Object.assign(row, { content_html: row.content_html ?? '', labels: row.labels ?? [], version: 1, deleted_at: null, created_at: ts, updated_at: ts });
      row.search_text = stripTags(row.content_html);
      break;
  }
  db.tables[table].push(row);
  notify(table, 'INSERT', row);
  return row;
}

function validateValue(row) {
  const t = db.tables;
  const task = t.tasks.find((x) => x.id === row.task_id);
  const prop = t.properties.find((x) => x.id === row.property_id);
  if (!task || !prop || task.board_id !== prop.board_id) throw err('23514', 'Свойство не принадлежит доске этой задачи');
  if (prop.type === 'select') {
    if (row.value_text != null || row.value_date != null) throw err('23514', 'Для списка нужны только выбранные варианты');
    if (prop.multiple) {
      const ids = row.option_ids ?? [];
      if (row.option_id != null || ids.length === 0) throw err('23514', 'Для списка с несколькими значениями нужен хотя бы один вариант');
      if (new Set(ids).size !== ids.length) throw err('23514', 'Варианты списка не должны повторяться');
      const owned = t.property_options.filter((x) => x.property_id === prop.id && ids.includes(x.id));
      if (owned.length !== ids.length) throw err('23514', 'Вариант не принадлежит этому свойству');
    } else {
      const o = t.property_options.find((x) => x.id === row.option_id);
      if (!row.option_id || (row.option_ids ?? []).length !== 0) throw err('23514', 'Для списка нужен ровно один выбранный вариант');
      if (!o || o.property_id !== prop.id) throw err('23514', 'Вариант не принадлежит этому свойству');
    }
  } else if (prop.type === 'text') {
    if (row.value_text == null || !row.value_text.trim() || row.value_date != null || row.option_id != null || (row.option_ids ?? []).length !== 0) throw err('23514', 'Для текстового свойства нужен непустой текст');
  } else if (prop.type === 'url') {
    if (row.value_text == null || row.value_date != null || row.option_id != null || (row.option_ids ?? []).length !== 0) throw err('23514', 'Для ссылки нужен URL');
    if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(row.value_text)) throw err('23514', 'Некорректная ссылка: нужен адрес вида https://...');
  } else if (prop.type === 'date') {
    if (row.value_date == null || row.value_text != null || row.option_id != null || (row.option_ids ?? []).length !== 0) throw err('23514', 'Для даты нужна дата');
  }
}

function updateRow(table, row, patch) {
  const old = { ...row };
  Object.assign(row, patch);
  const ts = now();
  if (table === 'tasks') {
    row.id = old.id; row.board_id = old.board_id; row.number = old.number; row.created_by = old.created_by; row.created_at = old.created_at;
    row.version = old.version + 1; row.updated_at = ts; row.updated_by = db.user;
    if (patch.column_id && !db.tables.board_columns.some((c) => c.id === row.column_id && c.board_id === row.board_id)) { Object.assign(row, old); throw err('23503', 'violates foreign key constraint'); }
    row.search_text = stripTags(row.description_html);
  } else if (table === 'knowledge_articles') {
    row.id = old.id; row.base_id = old.base_id; row.version = old.version + 1; row.updated_at = ts;
    if ((row.labels || []).length > 20) { Object.assign(row, old); throw err('23514', 'check constraint'); }
    row.search_text = stripTags(row.content_html);
  } else if (table === 'task_values') {
    try { validateValue(row); } catch (e) { Object.assign(row, old); throw e; }
    row.updated_at = ts;
  } else if (table === 'properties') {
    if (patch.type && patch.type !== old.type && db.tables.task_values.some((v) => v.property_id === row.id)) { Object.assign(row, old); throw err('23514', 'Нельзя сменить тип свойства: у него уже есть значения в задачах'); }
    if (row.archived_at === null && db.tables.properties.some((p) => p !== row && p.board_id === row.board_id && p.archived_at === null && p.name.trim().toLowerCase() === row.name.trim().toLowerCase())) {
      Object.assign(row, old); throw err('23505', 'duplicate key value violates unique constraint "properties_name_uniq"');
    }
    row.updated_at = ts;
  } else if (table === 'property_options') {
    if (db.tables.property_options.some((o) => o !== row && o.property_id === row.property_id && o.label.trim().toLowerCase() === row.label.trim().toLowerCase())) { Object.assign(row, old); throw err('23505', 'duplicate key value violates unique constraint "property_options_label_uniq"'); }
    row.updated_at = ts;
  } else if (row.updated_at !== undefined) row.updated_at = ts;
  notify(table, 'UPDATE', row);
}

// правила удаления: аналог политик RLS и внешних ключей. false: строка не затронута (без ошибки)
function canDelete(table, row) {
  switch (table) {
    case 'boards': case 'board_columns': case 'properties': case 'knowledge_bases': return row.archived_at !== null;
    case 'tasks': case 'knowledge_articles': return row.deleted_at !== null;
    default: return true;
  }
}
function removeRow(table, row) {
  const t = db.tables;
  if (table === 'board_columns' && t.tasks.some((x) => x.column_id === row.id)) throw err('23503', 'violates foreign key constraint');
  if (table === 'property_options' && t.task_values.some((v) => v.option_id === row.id || (v.option_ids ?? []).includes(row.id)))
    throw err('23503', 'violates foreign key constraint "task_values_option_id_fkey"');
  const drop = (name, pred) => { t[name] = t[name].filter((r) => !pred(r)); };
  if (table === 'boards') {
    const props = t.properties.filter((p) => p.board_id === row.id).map((p) => p.id);
    const tasks = t.tasks.filter((x) => x.board_id === row.id).map((x) => x.id);
    drop('task_values', (v) => tasks.includes(v.task_id) || props.includes(v.property_id));
    drop('property_options', (o) => props.includes(o.property_id));
    drop('tasks', (x) => x.board_id === row.id); drop('board_columns', (c) => c.board_id === row.id);
    drop('properties', (p) => p.board_id === row.id); drop('views', (v) => v.board_id === row.id);
  } else if (table === 'tasks') drop('task_values', (v) => v.task_id === row.id);
  else if (table === 'properties') { drop('task_values', (v) => v.property_id === row.id); drop('property_options', (o) => o.property_id === row.id); }
  else if (table === 'knowledge_bases') drop('knowledge_articles', (a) => a.base_id === row.id);
  drop(table, (r) => r === row);
  notify(table, 'DELETE', row);
}

// ---------------- разбор фильтров
function splitTop(s, sep) {
  const out = []; let cur = ''; let inQ = false; let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && inQ) { cur += c + s[++i]; continue; }
    if (c === '"') inQ = !inQ;
    if (!inQ && c === '(') depth++;
    if (!inQ && c === ')') depth--;
    if (!inQ && depth === 0 && c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  if (cur !== '') out.push(cur);
  return out;
}
function unquote(v) {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
  return v;
}
function likeToRegex(p) {
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\') re += (p[++i] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (c === '%') re += '.*'; else if (c === '_') re += '.';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'is');
}
function getVal(row, col) {
  if (col.includes('.')) { const [emb, f] = col.split('.'); return row[emb]?.[f]; }
  return row[col];
}

class Query {
  constructor(table) { this.table = table; this.op = 'select'; this.cols = '*'; this.filters = []; this.orders = []; this.range_ = null; this.mode = null; this.returning = false; this.opts = {}; }
  select(cols = '*', opts = {}) { if (this.op === 'select') { this.cols = cols; this.opts = opts; } else { this.returning = true; this.cols = cols; } return this; }
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  upsert(p, o) { this.op = 'upsert'; this.payload = p; this.onConflict = o?.onConflict; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push((r) => getVal(r, c) === v); return this; }
  is(c, v) { this.filters.push((r) => (getVal(r, c) ?? null) === v); return this; }
  not(c, op, v) { this.filters.push((r) => !((getVal(r, c) ?? null) === v)); return this; }
  in(c, arr) { this.filters.push((r) => arr.includes(getVal(r, c))); return this; }
  or(str) {
    const parts = splitTop(str, ',').map((p) => {
      const m = p.match(/^([\w.]+)\.ilike\.(.*)$/s);
      return { col: m[1], re: likeToRegex(unquote(m[2])) };
    });
    this.filters.push((r) => parts.some((p) => p.re.test(String(getVal(r, p.col) ?? ''))));
    return this;
  }
  order(c, o = {}) { this.orders.push({ c, asc: o.ascending !== false }); return this; }
  range(a, b) { this.range_ = [a, b]; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then(res, rej) {
    // задержка ответа, как у сети: тесты задают window.__latency (мс); вычисление выполняется в момент «прихода» запроса
    const wait = () => new Promise((r) => setTimeout(r, window.__latency ? window.__latency * (0.5 + Math.random()) : 0));
    return wait().then(() => this.exec()).then((r) => wait().then(() => r)).then(res, rej);
  }

  rowsFor() {
    let rows = db.tables[this.table];
    if (this.table === 'task_values' && /tasks!inner/.test(this.cols)) rows = rows.map((r) => ({ ...r, tasks: db.tables.tasks.find((t) => t.id === r.task_id) })).filter((r) => r.tasks);
    if (this.table === 'views') rows = rows.filter((v) => v.owner_id === null || v.owner_id === db.user);
    return rows.filter((r) => this.filters.every((f) => f(r)));
  }
  project(r) {
    if (this.cols === '*' || !this.cols) return { ...r };
    const names = splitTop(this.cols, ',').map((s) => s.trim()).filter((s) => !s.includes('('));
    const out = {};
    for (const n of names) out[n] = r[n];
    if (/tasks!inner/.test(this.cols)) out.tasks = { board_id: r.tasks?.board_id };
    return out;
  }
  finish(rows) {
    const out = rows.map((r) => this.project(r));
    if (this.mode === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
    if (this.mode === 'maybe') return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
  exec() {
    try {
      if (this.op === 'select') {
        let rows = this.rowsFor();
        if (this.opts.head) return { data: null, count: rows.length, error: null };
        for (const o of [...this.orders].reverse()) rows = [...rows].sort((a, b) => {
          const x = getVal(a, o.c), y = getVal(b, o.c);
          if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
        });
        if (this.range_) rows = rows.slice(this.range_[0], this.range_[1] + 1);
        return this.finish(rows);
      }
      if (this.op === 'insert' || this.op === 'upsert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        const done = [];
        for (const p of list) {
          if (this.op === 'upsert') {
            const keys = (this.onConflict || '').split(',');
            const ex = db.tables[this.table].find((r) => keys.every((k) => r[k] === p[k]));
            if (ex) { updateRow(this.table, ex, p); done.push(ex); continue; }
          }
          done.push(insertRow(this.table, p));
        }
        return this.returning ? this.finish(done) : { data: null, error: null };
      }
      if (this.op === 'update') {
        const rows = this.rowsFor();
        for (const r of rows) updateRow(this.table, r, this.payload);
        return this.returning ? this.finish(rows) : { data: null, error: null };
      }
      if (this.op === 'delete') {
        const rows = this.rowsFor().filter((r) => canDelete(this.table, r));
        for (const r of rows) removeRow(this.table, r);
        return this.returning ? this.finish(rows) : { data: null, error: null };
      }
    } catch (e) {
      return { data: null, error: { message: e.message, code: e.code } };
    }
    return { data: null, error: { message: 'unsupported' } };
  }
}

const rpcs = {
  archive_column({ p_column_id }) {
    const c = db.tables.board_columns.find((x) => x.id === p_column_id && x.archived_at === null);
    if (!c) throw err('P0002', 'Колонка не найдена или уже в архиве');
    const ts = now(); c.archived_at = ts; notify('board_columns', 'UPDATE', c);
    db.tables.tasks.filter((t) => t.column_id === c.id && t.archived_at === null && t.deleted_at === null).forEach((t) => { t.archived_at = ts; t.version++; notify('tasks', 'UPDATE', t); });
  },
  restore_column({ p_column_id }) {
    const c = db.tables.board_columns.find((x) => x.id === p_column_id);
    if (!c || c.archived_at === null) throw err('P0002', 'Колонка не найдена или не в архиве');
    const ts = c.archived_at; c.archived_at = null; notify('board_columns', 'UPDATE', c);
    db.tables.tasks.filter((t) => t.column_id === c.id && t.archived_at === ts && t.deleted_at === null).forEach((t) => { t.archived_at = null; t.version++; notify('tasks', 'UPDATE', t); });
  },
  restore_task({ p_task_id }) {
    const t = db.tables.tasks.find((x) => x.id === p_task_id && x.deleted_at === null && x.archived_at !== null);
    if (!t) throw err('P0002', 'Карточка не найдена, удалена или не в архиве');
    t.archived_at = null; t.version++; notify('tasks', 'UPDATE', t);
    const c = db.tables.board_columns.find((x) => x.id === t.column_id); if (c && c.archived_at) { c.archived_at = null; notify('board_columns', 'UPDATE', c); }
  },
  delete_column_forever({ p_column_id }) {
    const c = db.tables.board_columns.find((x) => x.id === p_column_id);
    if (!c) throw err('P0002', 'Колонка не найдена');
    if (c.archived_at === null) throw err('P0001', 'Колонку можно удалить насовсем только из архива');
    const doomed = db.tables.tasks.filter((t) => t.column_id === c.id);
    for (const t of doomed) removeRow('tasks', t);
    removeRow('board_columns', c);
    return doomed.length;
  },
  restore_task_from_trash({ p_task_id }) {
    const t = db.tables.tasks.find((x) => x.id === p_task_id && x.deleted_at !== null);
    if (!t) throw err('P0002', 'Карточка не найдена или не в корзине');
    t.deleted_at = null; t.version++;
    const c = db.tables.board_columns.find((x) => x.id === t.column_id); if (c && c.archived_at) t.archived_at = t.archived_at ?? now();
    notify('tasks', 'UPDATE', t);
  },
  clear_option_values({ p_option_id }) {
    const option = db.tables.property_options.find((x) => x.id === p_option_id);
    if (!option) return;
    const keep = [];
    for (const v of db.tables.task_values) {
      if (v.property_id !== option.property_id) { keep.push(v); continue; }
      if (v.option_id === p_option_id) continue;
      if (!(v.option_ids ?? []).includes(p_option_id)) { keep.push(v); continue; }
      const ids = v.option_ids.filter((id) => id !== p_option_id);
      if (ids.length === 0) continue;
      v.option_ids = ids; v.updated_at = now(); keep.push(v);
    }
    db.tables.task_values = keep;
  },
  set_property_multiple({ p_property_id, p_multiple }) {
    const p = db.tables.properties.find((x) => x.id === p_property_id);
    if (!p) throw err('P0002', 'Свойство не найдено');
    if (p.type !== 'select') throw err('23514', 'Несколько значений бывает только у свойства-списка');
    p.multiple = p_multiple;
    for (const v of db.tables.task_values) {
      if (v.property_id !== p_property_id) continue;
      if (p_multiple && v.option_id !== null) {
        v.option_ids = [v.option_id];
        v.option_id = null;
      } else if (!p_multiple && v.option_id === null && (v.option_ids ?? []).length > 0) {
        v.option_id = v.option_ids[0];
        v.option_ids = [];
      }
      v.updated_at = now();
    }
  },
};

const emitAuth = (event) => db.authListeners.forEach((cb) => cb(event, db.session));

export function createClient() {
  return {
    from: (t) => new Query(t),
    rpc: async (name, args) => { try { const data = rpcs[name](args); return { data: data ?? null, error: null }; } catch (e) { return { data: null, error: { message: e.message, code: e.code } }; } },
    channel: () => {
      const ch = { on(_type, filter, cb) { db.handlers.push({ table: filter.table, cb, ch }); return ch; }, subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 5); return ch; } };
      return ch;
    },
    removeChannel: async (ch) => { db.handlers = db.handlers.filter((h) => h.ch !== ch); },
    auth: {
      getSession: async () => ({ data: { session: db.session } }),
      onAuthStateChange: (cb) => { db.authListeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', db.session), 0); return { data: { subscription: { unsubscribe() { db.authListeners = db.authListeners.filter((x) => x !== cb); } } } }; },
      signInWithPassword: async ({ email, password }) => {
        if (password !== 'правильный-пароль') return { error: { message: 'Invalid login credentials' } };
        db.session = { user: ME }; emitAuth('SIGNED_IN'); return { error: null };
      },
      signOut: async () => { db.session = null; emitAuth('SIGNED_OUT'); return { error: null }; },
      updateUser: async ({ password }) => (password === 'тот-же-пароль-1' ? { error: { message: 'New password should be different from the old password.' } } : { error: null }),
    },
  };
}

// для тестов: прямой доступ и «другой участник»
window.__db = db;
window.__other = {
  update(table, id, patch) { const row = db.tables[table].find((r) => r.id === id); const prev = db.user; db.user = 'u-anna'; try { updateRow(table, row, patch); } finally { db.user = prev; } },
  insert(table, row) { const prev = db.user; db.user = 'u-anna'; try { return insertRow(table, row); } finally { db.user = prev; } },
};
