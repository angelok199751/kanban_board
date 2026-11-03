const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const DIST = path.join(__dirname, 'dist', 'index.html');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'qaflow-e2e-'));
const results = []; const problems = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name + ' :: ' + String(e.message).split('\n').slice(0, 3).join(' ⏎ ').slice(0, 400)]); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.push('CONSOLE ' + m.text()); });
  page.setDefaultTimeout(8000);
  await page.addInitScript((ms) => { window.__latency = ms; }, Number(process.env.LATENCY || 0));
  await page.goto('file://' + DIST);
  await page.waitForSelector('text=Здесь пока пусто');

  const dlg = () => page.locator('.dialog').last();
  const submit = async (label) => { await dlg().getByRole('button', { name: label, exact: true }).click(); };
  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__db.tables)));
  const col = (name) => page.locator('.column', { has: page.locator('h3', { hasText: new RegExp('^' + name + '$') }) });
  const openCard = async (title) => { await page.locator('.task-slot', { hasText: title }).first().click(); await page.waitForSelector('.dialog textarea, .dialog .rich-field'); };
  const closeTheme = () => dlg().locator('.editor-footer').getByRole('button', { name: 'Закрыть', exact: true }).click();
  const choose = async (name, label) => {
    await dlg().locator('.property', { has: page.locator('label', { hasText: new RegExp('^' + name + '$') }) }).locator('.pill-select-btn').click();
    await page.locator('.pill-menu').getByRole('option', { name: label, exact: true }).click();
  };
  const closeCard = async () => { await dlg().getByRole('button', { name: 'Готово', exact: true }).click(); await page.waitForSelector('.dialog', { state: 'detached' }); };
  const field = (name) => dlg().locator('.property', { has: page.locator('label', { hasText: new RegExp('^' + name + '$') }) });

  // ---------------- доски и колонки
  await step('A. создать доску', async () => {
    await page.getByLabel('Создать доску').click();
    await page.locator('#boardName').fill('Релиз 143');
    await submit('Создать');
    await page.waitForSelector('h1.board-title:has-text("Релиз 143")');
    await page.waitForSelector('text=Доска пустая');
  });
  await step('B. создать три колонки', async () => {
    for (const n of ['Новые', 'В работе', 'Готово']) {
      await page.locator('.add-column').click();
      await page.locator('#columnName').fill(n);
      await submit('Создать');
      await page.waitForSelector(`h3:text-is("${n}")`);
    }
    eq(await page.locator('.column').count(), 3, 'колонок');
  });
  await step('C. карточки: создание и нумерация', async () => {
    await col('Новые').locator('.add-task').click();
    for (const t of ['Войти в систему', 'Выйти из системы', 'Сменить пароль']) {
      // форма остаётся открытой: можно сразу вводить следующую карточку
      await col('Новые').getByPlaceholder('Название карточки').fill(t);
      await page.keyboard.press('Enter');
      await page.waitForSelector(`.task-title:text-is("${t}")`);
    }
    await col('В работе').locator('.add-task').click();
    await col('В работе').getByPlaceholder('Название карточки').fill('Экспорт отчёта');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.task-title:text-is("Экспорт отчёта")');
    const nums = await page.locator('.task-id').allInnerTexts();
    eq(nums.sort(), ['#1', '#2', '#3', '#4'], 'номера');
  });

  // ---------------- свойства
  await step('D. свойства и варианты', async () => {
    await page.getByLabel('Свойства карточек').click();
    for (const [name, type] of [['Исполнитель', 'select'], ['Срок', 'date'], ['Ссылка', 'url'], ['Заметка', 'text']]) {
      await dlg().getByPlaceholder('Название нового свойства').fill(name);
      await dlg().getByLabel('Тип свойства').selectOption(type);
      await dlg().getByRole('button', { name: 'Добавить', exact: true }).click();
      await page.waitForSelector(`.prop-row input[value="${name}"]`);
    }
    // дубликат имени отклоняется понятным сообщением
    await dlg().getByPlaceholder('Название нового свойства').fill('исполнитель');
    await dlg().getByRole('button', { name: 'Добавить', exact: true }).click();
    await page.waitForSelector('.toast:has-text("Свойство с таким названием уже есть")');
    await dlg().getByPlaceholder('Название нового свойства').fill('');
    await page.locator('.prop-row', { has: page.locator('input[value="Исполнитель"]') }).getByRole('button', { name: 'Варианты' }).click();
    for (const o of ['Анна', 'Борис']) {
      await dlg().getByPlaceholder('Новый вариант').fill(o);
      await page.keyboard.press('Enter');
      await page.waitForSelector(`.dialog input[value="${o}"]`);
    }
    await submit('Готово'); // варианты
    await submit('Готово'); // свойства
  });

  // ---------------- редактор карточки
  await step('E1. поля карточки и автосохранение', async () => {
    await openCard('Войти в систему');
    await choose('Исполнитель', 'Анна');
    await field('Срок').locator('input[type=date]').fill('2026-03-01');
    await field('Заметка').locator('input').fill('Проверить на стенде');
    await field('Заметка').locator('input').blur();
    await page.waitForSelector('.save-status:has-text("Все изменения сохранены")');
  });
  await step('E2. неверная ссылка не теряется и блокирует закрытие', async () => {
    await field('Ссылка').locator('input').fill('abc');
    await field('Ссылка').locator('input').blur();
    await page.waitForSelector('.save-status:has-text("Не сохранено")');
    await dlg().getByRole('button', { name: 'Готово', exact: true }).click();
    await page.waitForSelector('button:has-text("Закрыть без сохранения")');
    ok(await page.locator('.dialog').count() > 0, 'окно закрылось, хотя есть ошибка');
    eq(await field('Ссылка').locator('input').inputValue(), 'abc', 'введённое потеряно');
    await field('Ссылка').locator('input').fill('https://example.com/login');
    await field('Ссылка').locator('input').blur();
    await page.waitForSelector('.save-status:has-text("Все изменения сохранены")');
  });
  await step('E3. описание с форматированием сохраняется само', async () => {
    await page.locator('.rich-field').click();
    await page.keyboard.type('Подробное описание задачи');
    await page.waitForFunction(() => window.__db.tables.tasks.some((x) => x.description_html.includes('Подробное описание задачи')), null, { timeout: 5000 });
    await page.waitForSelector('.save-status:has-text("Все изменения сохранены")', { timeout: 5000 });
    await closeCard();
    const chips = await page.locator('.task-slot', { hasText: 'Войти в систему' }).locator('.pill').allInnerTexts();
    ok(chips.some((x) => x.includes('Анна')), 'нет значка варианта: ' + chips.join('|'));
    ok(chips.some((x) => x.includes('example.com')), 'нет ссылки: ' + chips.join('|'));
    ok(chips.some((x) => x.includes('01.03.2026')), 'нет даты: ' + chips.join('|'));
  });


  const shots = process.env.SHOTS;
  const shot = async (name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png') }); } };
  await step('E4. три раскладки окна карточки, сворачивание свойств, запоминание выбора', async () => {
    await openCard('Войти в систему');
    const cls = () => dlg().locator('.editor-body').getAttribute('class');
    const box = (sel) => dlg().locator(sel).boundingBox();
    const pick = async (re) => { await dlg().getByRole('radio', { name: re }).click(); await page.waitForTimeout(350); };
    ok((await cls()).includes('layout-top'), 'по умолчанию свойства сверху');
    let p = await box('.props-pane'), x = await box('.text-pane');
    ok(p.y < x.y && Math.abs(p.x - x.x) < 40, `сверху: свойства выше текста (${p.y} < ${x.y})`);
    await shot('card-top-dark');
    await pick(/Свойства слева/);
    ok((await cls()).includes('layout-left'), 'класс layout-left');
    p = await box('.props-pane'); x = await box('.text-pane');
    ok(p.x < x.x && Math.abs(p.y - x.y) < 40, 'слева: свойства левее текста');
    ok(Math.abs(p.width - 340) < 4, 'ширина панели свойств 340: ' + p.width);
    await shot('card-left-dark');
    await pick(/Свойства справа/);
    p = await box('.props-pane'); x = await box('.text-pane');
    ok(p.x > x.x && Math.abs(p.y - x.y) < 40, 'справа: свойства правее текста');
    await shot('card-right-dark');
    // сворачивание сбоку: остаётся узкая полоса, текст расширяется
    const textBefore = (await box('.text-pane')).width;
    await dlg().locator('.props-toggle').click(); await page.waitForTimeout(400);
    eq(await dlg().locator('.props-toggle').getAttribute('aria-expanded'), 'false', 'aria-expanded');
    p = await box('.props-pane');
    ok(p.width < 60, 'свёрнутая панель узкая: ' + p.width);
    ok((await box('.text-pane')).width > textBefore + 200, 'текст не занял освободившееся место');
    await shot('card-right-collapsed-dark');
    await dlg().locator('.props-toggle').click(); await page.waitForTimeout(400);
    // сворачивание сверху: высота свойств уходит, сводка значений видна
    await pick(/Свойства сверху/);
    await dlg().locator('.props-toggle').click(); await page.waitForTimeout(450);
    const h = (await box('.props-scroll'))?.height ?? 0;
    ok(h < 5, 'свёрнутая область сверху имеет высоту ' + h);
    ok(await dlg().locator('.props-summary .pill').count() >= 3, 'в сводке нет значений свойств');
    await shot('card-top-collapsed-dark');
    await dlg().locator('.props-toggle').click(); await page.waitForTimeout(450);
    ok((await box('.props-scroll')).height > 50, 'область свойств не вернулась');
    // выбор запоминается: закрываем окно и открываем заново
    await pick(/Свойства слева/);
    eq(await page.evaluate(() => localStorage.getItem('qaflow.cardLayout')), 'left', 'настройка сохранена в браузере');
    await closeCard();
    await openCard('Выйти из системы');
    ok((await cls()).includes('layout-left'), 'раскладка не запомнилась');
    await shot('card-left-reopened-dark');
    // светлая тема
    await page.evaluate(() => { const r = document.documentElement; r.dataset.resolvedTheme = 'light'; r.style.colorScheme = 'light'; });
    await shot('card-left-light');
    await pick(/Свойства сверху/); await shot('card-top-light');
    await page.evaluate(() => { const r = document.documentElement; r.dataset.resolvedTheme = 'dark'; r.style.colorScheme = 'dark'; });
    await closeCard();
  });
  await step('E5. столбец сворачивается до заголовка и запоминается', async () => {
    const column = col('Новые');
    const before = await column.locator('.task-slot').count();
    ok(before >= 3, 'в колонке должно быть несколько карточек');
    await shot('board-dark');
    await column.getByLabel('Свернуть колонку').click();
    await page.waitForSelector('.column.collapsed');
    eq(await column.locator('.task-slot').count() > 0 && await column.locator('.cards').isVisible(), false, 'карточки видны в свёрнутом столбце');
    eq(await column.locator('.count').innerText(), String(before), 'счётчик остался');
    const boardId = (await db()).boards[0].id;
    eq(await page.evaluate((id) => localStorage.getItem('qaflow.collapsed.' + id), boardId), JSON.stringify([(await db()).board_columns.find((c) => c.name === 'Новые').id]), 'свёрнутое запомнено');
    await shot('board-collapsed-dark');
    await column.getByLabel('Развернуть колонку').click();
    await page.waitForFunction(() => !document.querySelector('.column.collapsed'));
    eq(await column.locator('.task-slot').count(), before, 'карточки не вернулись');
  });

  // ---------------- поиск, фильтры, сортировка, представления
  await step('F. поиск по названию и по тексту описания', async () => {
    await page.getByLabel('Поиск по карточкам').fill('описание');
    await page.waitForSelector('.counter:has-text("Показано 1 из 4")');
    eq(await page.locator('.task-slot').count(), 1, 'найдено');
    await page.getByLabel('Поиск по карточкам').fill('#3');
    await page.waitForSelector('.counter:has-text("Показано 1 из 4")');
    await page.waitForSelector('.task-title:text-is("Сменить пароль")');
    await page.getByLabel('Поиск по карточкам').fill('');
    await page.waitForSelector('.counter:has-text("Карточек: 4")');
  });
  await step('G. фильтр по варианту списка', async () => {
    await page.getByRole('button', { name: /^Фильтры/ }).click();
    await dlg().getByLabel('Анна').check();
    await page.waitForSelector('.counter:has-text("Показано 1 из 4")');
    await submit('Готово');
    ok(await page.locator('.view-actions').count() > 0, 'нет признака «настройки изменены»');
  });
  await step('H. личное представление', async () => {
    await page.getByRole('button', { name: 'Сохранить как…' }).click();
    await dlg().locator('#viewName').fill('Анины задачи');
    await submit('Сохранить');
    await page.waitForSelector('.view-tab:has-text("Анины задачи")');
    await page.waitForSelector('.view-tag:has-text("личное")');
    eq(await page.locator('.view-actions').count(), 0, 'после сохранения остались «изменения»');
    const v = (await db()).views[0];
    eq(v.owner_id, 'u-an', 'владелец личного представления');
    await page.locator('.view-tab', { hasText: 'Все задачи' }).click();
    await page.waitForSelector('.counter:has-text("Карточек: 4")');
    await page.locator('.view-tab', { hasText: 'Анины задачи' }).click();
    await page.waitForSelector('.counter:has-text("Показано 1 из 4")');
    await page.locator('.view-tab', { hasText: 'Все задачи' }).click();
  });
  await step('I. сортировка и компактный вид', async () => {
    await page.getByLabel('Сортировка').selectOption('title');
    const titles = await col('Новые').locator('.task-title').allInnerTexts();
    eq(titles, ['Войти в систему', 'Выйти из системы', 'Сменить пароль'], 'порядок по названию');
    await page.getByLabel('Направление сортировки').click();
    eq(await col('Новые').locator('.task-title').allInnerTexts(), ['Сменить пароль', 'Выйти из системы', 'Войти в систему'], 'обратный порядок');
    await page.getByLabel('Компактный вид').click();
    eq(await page.locator('.task-meta').count(), 0, 'в компактном виде остались поля');
    await page.getByLabel('Компактный вид').click();
    await page.getByLabel('Сортировка').selectOption('manual');
  });

  // ---------------- перетаскивание (через обработчики, которые приложение отдаёт DndContext)
  // между событиями перетаскивания React успевает перерисоваться, поэтому вызываем их по отдельности и берём свежие обработчики
  const drag = async (activeId, overId, extra = {}) => {
    const call = (name, ev) => page.evaluate(([n, e]) => window.__dnd[n](e), [name, ev]);
    const active = { id: activeId, rect: { current: { translated: { top: extra.top ?? 100 } } } };
    const over = { id: overId, rect: { top: 0, height: 10 } };
    await call('onDragStart', { active }); await page.waitForTimeout(80);
    await call('onDragOver', { active, over }); await page.waitForTimeout(80);
    await call('onDragEnd', { active, over });
  };
  await step('J1. перенос карточки в другую колонку', async () => {
    const t = (await db()).tasks.find((x) => x.title === 'Выйти из системы');
    const target = (await db()).board_columns.find((c) => c.name === 'Готово');
    await drag('task:' + t.id, 'col:' + target.id);
    await page.waitForFunction(([id, c]) => window.__db.tables.tasks.find((x) => x.id === id).column_id === c, [t.id, target.id]);
    await col('Готово').locator('.task-title:text-is("Выйти из системы")').waitFor();
  });
  await step('J2. порядок карточек внутри колонки', async () => {
    const d = await db();
    const a = d.tasks.find((x) => x.title === 'Войти в систему'), c = d.tasks.find((x) => x.title === 'Сменить пароль');
    await drag('task:' + c.id, 'task:' + a.id, { top: -50 }); // «Сменить пароль» над «Войти в систему»
    await page.waitForFunction(() => { const c = [...document.querySelectorAll('.column')].find((x) => x.querySelector('h3').textContent === 'Новые'); return JSON.stringify([...c.querySelectorAll('.task-title')].map((x) => x.textContent)) === JSON.stringify(['Сменить пароль', 'Войти в систему']); });
  });
  await step('J3. порядок колонок', async () => {
    const d = await db();
    const a = d.board_columns.find((c) => c.name === 'Новые'), b = d.board_columns.find((c) => c.name === 'Готово');
    await page.evaluate(([x, y]) => { const e = { active: { id: 'col:' + x }, over: { id: 'col:' + y } }; window.__dnd.onDragStart({ active: e.active }); window.__dnd.onDragEnd(e); }, [a.id, b.id]);
    await page.waitForFunction(() => JSON.stringify([...document.querySelectorAll('.column-head h3')].map((h) => h.textContent)) === JSON.stringify(['В работе', 'Готово', 'Новые']));
  });

  // ---------------- синхронизация и конфликты
  await step('K. чужое изменение приходит само (realtime)', async () => {
    const t = (await db()).tasks.find((x) => x.title === 'Экспорт отчёта');
    await page.evaluate((id) => window.__other.update('tasks', id, { title: 'Экспорт отчёта (правка Анны)' }), t.id);
    await page.waitForSelector('.task-title:text-is("Экспорт отчёта (правка Анны)")', { timeout: 3000 });
    const n = await page.evaluate(() => { window.__other.insert('tasks', { board_id: window.__db.tables.boards[0].id, column_id: window.__db.tables.board_columns[0].id, title: 'Карточка от Анны', position: 'zz' }); return 1; });
    await page.waitForSelector('.task-title:text-is("Карточка от Анны")', { timeout: 3000 });
  });
  await step('L1. конфликт названия: загрузить свежую версию', async () => {
    await openCard('Сменить пароль');
    const t = (await db()).tasks.find((x) => x.title === 'Сменить пароль');
    await page.evaluate((id) => window.__other.update('tasks', id, { title: 'Сменить пароль (Анна)' }), t.id);
    await dlg().locator('#taskTitle').fill('Моё название');
    await dlg().locator('#taskTitle').blur();
    await page.waitForSelector('.conflict:has-text("Карточку уже изменил кто-то другой")');
    await dlg().getByRole('button', { name: 'Загрузить свежую версию' }).click();
    eq(await dlg().locator('#taskTitle').inputValue(), 'Сменить пароль (Анна)', 'свежее название');
    await closeCard();
  });
  await step('L2. перенос карточки не считается конфликтом', async () => {
    await openCard('Войти в систему');
    const d = await db(); const t = d.tasks.find((x) => x.title === 'Войти в систему');
    const other = d.board_columns.find((c) => c.name === 'Готово');
    await page.evaluate(([id, c]) => window.__other.update('tasks', id, { column_id: c }), [t.id, other.id]);
    await dlg().locator('#taskTitle').fill('Войти в систему (новое)');
    await dlg().locator('#taskTitle').blur();
    await page.waitForSelector('.save-status:has-text("Все изменения сохранены")');
    eq((await db()).tasks.find((x) => x.id === t.id).title, 'Войти в систему (новое)', 'название сохранено');
    await closeCard();
  });
  await step('L3. конфликт значения свойства', async () => {
    await openCard('Выйти из системы');
    const d = await db(); const t = d.tasks.find((x) => x.title === 'Выйти из системы');
    const p = d.properties.find((x) => x.name === 'Заметка');
    await page.evaluate(([tid, pid]) => window.__other.insert('task_values', { task_id: tid, property_id: pid, value_text: 'заметка Анны' }), [t.id, p.id]);
    await field('Заметка').locator('input').fill('моя заметка');
    await field('Заметка').locator('input').blur();
    await page.waitForSelector('.conflict:has-text("Это значение уже изменил другой участник")');
    await field('Заметка').getByRole('button', { name: 'Оставить моё' }).click();
    await page.waitForSelector('.save-status:has-text("Все изменения сохранены")');
    eq((await db()).task_values.find((v) => v.task_id === t.id && v.property_id === p.id).value_text, 'моя заметка', 'значение после «оставить моё»');
    await closeCard();
  });

  // ---------------- экспорт
  await step('M. экспорт XLSX скачивается и читается', async () => {
    await page.getByLabel('Экспорт', { exact: true }).click();
    await dlg().locator('.export-field-row', { hasText: 'Описание' }).locator('input[type=checkbox]').check();
    const [download] = await Promise.all([page.waitForEvent('download'), dlg().getByRole('button', { name: 'Скачать файл' }).click()]);
    await download.saveAs(path.join(OUT, 'export.xlsx'));
    await page.waitForSelector('.success:has-text("Готово")');
    ok(fs.statSync(path.join(OUT, 'export.xlsx')).size > 1000, 'файл пустой');
    await submit('Закрыть');
  });
  await step('M2. экспорт CSV одной колонки', async () => {
    await page.getByLabel('Экспорт', { exact: true }).click();
    await dlg().locator('select').nth(1).selectOption({ label: 'Готово' });
    await dlg().locator('select').nth(2).selectOption('csv');
    const [download] = await Promise.all([page.waitForEvent('download'), dlg().getByRole('button', { name: 'Скачать файл' }).click()]);
    await download.saveAs(path.join(OUT, 'export.csv'));
    await submit('Закрыть');
  });

  // ---------------- архив и корзина
  await step('N1. карточка в корзину и обратно', async () => {
    await openCard('Экспорт отчёта (правка Анны)');
    await dlg().getByRole('button', { name: 'В корзину' }).click();
    await page.locator('.dialog').last().getByRole('button', { name: 'Убрать в корзину' }).click();
    await page.waitForSelector('.task-title:text-is("Экспорт отчёта (правка Анны)")', { state: 'detached' });
    const t = (await db()).tasks.find((x) => x.title.startsWith('Экспорт отчёта'));
    ok(t.deleted_at, 'в базе нет deleted_at');
    await page.locator('.sidebar-footer .side-item').click();
    await page.getByRole('tab', { name: /Корзина/ }).click();
    await page.waitForSelector('.archive-row:has-text("Экспорт отчёта")');
    await page.locator('.archive-row', { hasText: 'Экспорт отчёта' }).getByRole('button', { name: 'Восстановить' }).click();
    await page.waitForSelector('.archive-row:has-text("Экспорт отчёта")', { state: 'detached' });
    ok(!(await db()).tasks.find((x) => x.id === t.id).deleted_at, 'не восстановлена');
  });
  await step('N2. удаление навсегда требует ввести слово', async () => {
    await page.getByRole('tab', { name: /Корзина/ }).click();
    // кладём карточку в корзину напрямую и пробуем удалить навсегда
    const t = (await db()).tasks[0];
    await page.evaluate((id) => { window.__db.tables.tasks.find((x) => x.id === id).deleted_at = new Date().toISOString(); window.__other.update('tasks', id, {}); }, t.id);
    await page.waitForSelector('.archive-row', { timeout: 3000 });
    await page.locator('.archive-row').first().getByRole('button', { name: 'Удалить навсегда' }).click();
    const confirm = dlg().getByRole('button', { name: 'Удалить навсегда' });
    ok(await confirm.isDisabled(), 'кнопка активна без ввода слова');
    await dlg().locator('#dangerPhrase').fill('удалить');
    ok(await confirm.isEnabled(), 'кнопка не включилась после ввода слова');
    await confirm.click();
    await page.waitForFunction((id) => !window.__db.tables.tasks.some((x) => x.id === id), t.id);
  });
  await step('N2b. массовое восстановление карточек из корзины', async () => {
    const d = await db();
    const two = d.tasks.filter((x) => !x.deleted_at).slice(0, 2);
    eq(two.length, 2, 'недостаточно карточек для массового действия');
    const labels = two.map((x) => `#${x.number} ${x.title}`);
    await page.evaluate((ids) => {
      ids.forEach((id) => {
        window.__db.tables.tasks.find((x) => x.id === id).deleted_at = new Date().toISOString();
        window.__other.update('tasks', id, {});
      });
    }, two.map((x) => x.id));
    await page.getByRole('tab', { name: /Корзина/ }).click();
    const rowFor = (label) => page.locator('.archive-row', { hasText: label });
    await rowFor(labels[0]).locator('.archive-check').check();
    await rowFor(labels[1]).locator('.archive-check').check();
    await page.waitForSelector('.archive-bulk:has-text("Выбрано: 2")');
    await page.locator('.archive-bulk').getByRole('button', { name: 'Восстановить' }).click();
    await page.waitForFunction(
      (ids) => ids.every((id) => window.__db.tables.tasks.find((x) => x.id === id).deleted_at === null),
      two.map((x) => x.id),
    );
    await rowFor(labels[0]).waitFor({ state: 'detached' });
    await rowFor(labels[1]).waitFor({ state: 'detached' });
    eq(await page.locator('.archive-bulk').count(), 0, 'панель массовых действий не закрылась');
  });
  await step('N3. колонка в архив вместе с карточками и возврат', async () => {
    await page.locator('.side-item', { hasText: 'Релиз 143' }).click();
    await page.waitForSelector('.column');
    const before = (await db()).tasks.filter((t) => !t.deleted_at && !t.archived_at).length;
    await col('В работе').getByLabel('Настроить колонку').click();
    await dlg().getByRole('button', { name: /Убрать колонку в архив/ }).click();
    await page.locator('.dialog').last().getByRole('button', { name: 'Убрать в архив', exact: true }).click();
    await page.waitForSelector('h3:text-is("В работе")', { state: 'detached' });
    await page.locator('.sidebar-footer .side-item').click();
    await page.getByRole('tab', { name: /Колонки/ }).click();
    await page.locator('.archive-row', { hasText: 'В работе' }).getByRole('button', { name: 'Восстановить' }).click();
    await page.waitForFunction(() => window.__db.tables.board_columns.find((c) => c.name === 'В работе').archived_at === null);
    await page.locator('.side-item', { hasText: 'Релиз 143' }).click();
    await page.waitForSelector('h3:text-is("В работе")');
    eq((await db()).tasks.filter((t) => !t.deleted_at && !t.archived_at).length, before, 'число активных карточек после возврата');
  });

  // ---------------- меню карточки
  await step('O1. меню карточки: Esc, клик вне, карточка не открывается', async () => {
    const title = 'Войти в систему (новое)';
    const card = page.locator('.task-slot', { hasText: title }).first();
    await card.hover();
    await card.getByRole('button', { name: /Действия с карточкой/ }).click();
    await page.waitForSelector('.task-menu');
    eq(await page.locator('.dialog').count(), 0, 'меню открыло карточку');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.task-menu', { state: 'detached' });
    await card.getByRole('button', { name: /Действия с карточкой/ }).click();
    await page.waitForSelector('.task-menu');
    await page.locator('h1.board-title').click();
    await page.waitForSelector('.task-menu', { state: 'detached' });
  });
  await step('O2. меню карточки: перенос внутри доски', async () => {
    const title = 'Сменить пароль (Анна)';
    const d = await db();
    const t = d.tasks.find((x) => x.title === title);
    ok(t, 'нет карточки для переноса');
    const target = d.board_columns.find((c) => c.id !== t.column_id && c.archived_at === null);
    ok(target, 'нет другой колонки');

    const openMove = async () => {
      const card = page.locator('.task-slot', { hasText: title }).first();
      await card.hover();
      await card.getByRole('button', { name: /Действия с карточкой/ }).click();
      await page.locator('.task-menu').getByRole('menuitem', { name: 'Переместить' }).click();
    };

    await openMove();
    await page.locator('.task-menu').getByRole('menuitem', { name: new RegExp('^' + target.name + '$') }).click();
    await page.waitForFunction(
      ([id, c]) => window.__db.tables.tasks.find((x) => x.id === id).column_id === c,
      [t.id, target.id],
    );
    await col(target.name).locator('.task-title:text-is("' + title + '")').waitFor();

    await openMove();
    await page.locator('.task-menu').getByRole('menuitem', { name: new RegExp('^' + d.board_columns.find((c) => c.id === t.column_id).name + '$') }).click();
    await page.waitForFunction(
      ([id, c]) => window.__db.tables.tasks.find((x) => x.id === id).column_id === c,
      [t.id, t.column_id],
    );
    eq(await page.locator('.dialog').count(), 0, 'перенос открыл карточку');
  });
  await step('O3. меню карточки: копия с названием и значениями, затем в корзину', async () => {
    const title = 'Войти в систему (новое)';
    const before = await db();
    const orig = before.tasks.find((x) => x.title === title);
    const origValues = before.task_values.filter((v) => v.task_id === orig.id);
    ok(origValues.length > 0, 'у карточки нет значений для проверки копии');

    const card = page.locator('.task-slot', { hasText: title }).first();
    await card.hover();
    await card.getByRole('button', { name: /Действия с карточкой/ }).click();
    await page.locator('.task-menu').getByRole('menuitem', { name: 'Копировать' }).click();
    await page.waitForSelector('.toast:has-text("Карточка скопирована")');
    await page.waitForFunction(
      (t) => window.__db.tables.tasks.filter((x) => x.title === t && !x.deleted_at).length === 2,
      title,
    );

    const d = await db();
    const copies = d.tasks.filter((x) => x.title === title && !x.deleted_at);
    const copy = copies.find((x) => x.id !== orig.id);
    ok(copy, 'копия не создана');
    ok(copy.id !== orig.id, 'копия получила тот же id');
    ok(copy.number !== orig.number, 'копия получила тот же номер');
    const fields = (v) => [v.property_id, v.value_text, v.value_date, v.option_id, (v.option_ids ?? []).join(',')];
    eq(
      d.task_values.filter((v) => v.task_id === copy.id).map(fields).sort(),
      origValues.map(fields).sort(),
      'значения не скопированы',
    );
    eq(await page.locator('.dialog').count(), 0, 'копирование открыло карточку');

    const copyCard = page.locator('.task-slot', { has: page.locator('.task-id', { hasText: '#' + copy.number }) });
    await copyCard.hover();
    await copyCard.getByRole('button', { name: 'Действия с карточкой #' + copy.number }).click();
    await page.locator('.task-menu').getByRole('menuitem', { name: 'В корзину' }).click();
    await page.waitForSelector('.dialog .confirm-text:has-text("уйдёт в корзину")');
    await dlg().getByRole('button', { name: 'Убрать в корзину' }).click();
    await page.waitForFunction((id) => window.__db.tables.tasks.find((x) => x.id === id).deleted_at !== null, copy.id);
    await copyCard.waitFor({ state: 'detached' });
  });

  // ---------------- базы знаний
  await step('P. база знаний и статья', async () => {
    await page.getByLabel('Создать базу знаний').click();
    await page.locator('#boardName').fill('Инструкции');
    await submit('Создать');
    await page.waitForSelector('h1.board-title:has-text("Инструкции")');
    await page.getByRole('button', { name: '＋ Статья' }).click();
    await page.locator('#boardName').fill('Как выпускать релиз');
    await submit('Создать');
    await page.waitForSelector('#articleTitle');
    await page.locator('#articleLabels').fill('релиз, Чек-лист, релиз');
    await page.locator('#articleLabels').blur();
    await page.locator('.rich-field').click();
    await page.keyboard.type('Сначала проверить сборку');
    await page.waitForFunction(() => window.__db.tables.knowledge_articles.some((x) => x.content_html.includes('проверить сборку')), null, { timeout: 5000 });
    await page.waitForSelector('.save-status:has-text("Все изменения сохранены")', { timeout: 5000 });
    const a = (await db()).knowledge_articles[0];
    eq(a.labels, ['релиз', 'Чек-лист'], 'метки без повторов');
    ok(a.content_html.includes('проверить сборку'), 'текст статьи не сохранён');
    await dlg().getByRole('button', { name: 'Готово', exact: true }).click();
    await page.waitForSelector('.dialog', { state: 'detached' });
    await page.getByLabel('Поиск по статьям').fill('чек');
    await page.waitForSelector('.knowledge-card:has-text("Как выпускать релиз")');
    await page.getByLabel('Поиск по статьям').fill('ничего-такого');
    await page.waitForSelector('text=Ничего не найдено');
    await page.getByLabel('Поиск по статьям').fill('сборку');
    await page.waitForSelector('.knowledge-card:has-text("Как выпускать релиз")');
  });
  await step('Q. статья в корзину и возврат', async () => {
    await page.getByLabel('Поиск по статьям').fill(''); // метка в центре карточки при клике запускает поиск по ней
    await page.locator('.knowledge-card-title').first().click();
    await page.waitForSelector('#articleTitle');
    await dlg().getByRole('button', { name: 'В корзину' }).click();
    await page.locator('.dialog').last().getByRole('button', { name: 'Убрать в корзину' }).click();
    await page.waitForSelector('.knowledge-card', { state: 'detached' });
    await page.locator('.sidebar-footer .side-item').click();
    await page.getByRole('tab', { name: /Знания/ }).click();
    await page.locator('.archive-row', { hasText: 'Как выпускать релиз' }).getByRole('button', { name: 'Восстановить' }).click();
    await page.waitForFunction(() => window.__db.tables.knowledge_articles[0].deleted_at === null);
  });

  // ---------------- архив доски
  await step('R. доска в архив и возврат', async () => {
    await page.locator('.side-item', { hasText: 'Релиз 143' }).click();
    await page.getByLabel('Убрать доску в архив').click();
    await page.locator('.dialog').last().getByRole('button', { name: 'Убрать в архив' }).click();
    await page.waitForSelector('.side-item:has-text("Релиз 143")', { state: 'detached' });
    await page.locator('.sidebar-footer .side-item').click();
    await page.getByRole('tab', { name: /Доски/ }).click();
    await page.locator('.archive-row', { hasText: 'Релиз 143' }).getByRole('button', { name: 'Восстановить' }).click();
    await page.waitForSelector('.side-item:has-text("Релиз 143")');
  });

  // ---------------- тема, вход и выход
  await step('S. тема переключается', async () => {
    await page.getByLabel('Тема интерфейса').first().click();
    await dlg().getByRole('radio', { name: 'Светлая' }).click();
    eq(await page.evaluate(() => document.documentElement.dataset.resolvedTheme), 'light', 'тема');
    await dlg().getByRole('radio', { name: 'Тёмная' }).click();
    await closeTheme();
  });
  await step('T. выход и вход: неверный пароль, верный пароль', async () => {
    await page.getByRole('button', { name: 'Выйти' }).click();
    await page.waitForSelector('text=Вход для команды');
    await page.locator('#login').fill('an'); await page.locator('#password').fill('не-тот');
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.waitForSelector('text=Неверный логин или пароль');
    await page.locator('#password').fill('правильный-пароль');
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.waitForSelector('.side-item:has-text("Релиз 143")');
  });


  // ---------------- дополнительные сценарии
  await step('U1. скрытие свойства глазом убирает его с карточки, но не из окна', async () => {
    await page.locator('.side-item', { hasText: 'Релиз 143' }).click(); // после шага R открыт раздел архива
    await page.waitForSelector('.board-toolbar');
    await page.getByLabel('Свойства карточек').click();
    await page.locator('.prop-row', { has: page.locator('input[value="Заметка"]') }).getByLabel('Скрыть на карточках').click();
    await submit('Готово');
    await page.waitForFunction(() => { const s = [...document.querySelectorAll('.task-slot')].find((x) => x.textContent.includes('Выйти из системы')); return s && !s.textContent.includes('моя заметка'); }, null, { timeout: 5000 });
    await openCard('Выйти из системы');
    eq(await field('Заметка').locator('input').inputValue(), 'моя заметка', 'в окне карточки значение должно быть видно');
    await closeCard();
    await page.getByLabel('Свойства карточек').click();
    await page.locator('.prop-row', { has: page.locator('input[value="Заметка"]') }).getByLabel('Показать на карточках').click();
    await submit('Готово');
  });
  await step('U2. свойство в архив с предупреждением и возврат со значениями', async () => {
    // карточка с датой из прошлых шагов уже удалена навсегда (шаг N2), поэтому ставим дату заново
    await openCard('Выйти из системы');
    await field('Срок').locator('input[type=date]').fill('2026-04-02');
    await page.waitForFunction(() => window.__db.tables.task_values.some((v) => v.value_date === '2026-04-02'));
    await closeCard();
    await page.getByLabel('Свойства карточек').click();
    await page.locator('.prop-row', { has: page.locator('input[value="Срок"]') }).getByLabel('Убрать в архив').click();
    ok((await dlg().innerText()).toLowerCase().includes('значения, которые уже заполнены, не удаляются'), 'нет предупреждения');
    await dlg().getByRole('button', { name: 'Убрать в архив', exact: true }).click();
    await page.waitForSelector('.prop-row input[value="Срок"]', { state: 'detached' });
    ok((await db()).task_values.some((v) => v.value_date === '2026-04-02'), 'значения потерялись при архивации свойства');
    await page.locator('details.archived summary').click();
    await page.locator('details.archived .prop-row', { hasText: 'Срок' }).getByRole('button', { name: 'Вернуть' }).click();
    await page.waitForSelector('.prop-row input[value="Срок"]');
    await submit('Готово');
  });
  await step('V. удаление используемого варианта: предупреждение и очистка значений', async () => {
    // вариант «Анна» к этому моменту нигде не выбран (карточка с ним удалена в шаге N2): выбираем заново
    await openCard('Выйти из системы');
    await choose('Исполнитель', 'Анна');
    await page.waitForFunction(() => window.__db.tables.task_values.some((v) => v.option_id));
    await closeCard();
    await page.getByLabel('Свойства карточек').click();
    await page.locator('.prop-row', { has: page.locator('input[value="Исполнитель"]') }).getByRole('button', { name: 'Варианты' }).click();
    await page.locator('.option-block', { has: page.locator('input[value="Анна"]') }).getByLabel('Удалить вариант').click();
    const txt = await dlg().innerText();
    ok(txt.includes('выбран в карточках: 1'), 'нет числа карточек: ' + txt);
    await dlg().getByRole('button', { name: 'Удалить и очистить значения' }).click();
    await page.waitForSelector('.dialog input[value="Анна"]', { state: 'detached' });
    ok(!(await db()).task_values.some((v) => v.option_id), 'значения варианта не очищены');
    await submit('Готово'); await submit('Готово');
  });
  await step('W. переименование и цвет колонки', async () => {
    await col('Готово').getByLabel('Настроить колонку').click();
    await dlg().locator('#columnName').fill('Сделано');
    await dlg().getByLabel('green').click();
    await submit('Сохранить');
    await page.waitForSelector('h3:text-is("Сделано")');
    eq((await db()).board_columns.find((c) => c.name === 'Сделано').color, 'green', 'цвет');
  });
  await step('X. индикатор потери связи и возврат', async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForSelector('.sync-offline:has-text("Нет связи")');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForSelector('.sync-offline', { state: 'detached' });
  });
  await step('Y. общее представление и личное: разные метки', async () => {
    await page.getByLabel('Компактный вид').click();
    await page.getByRole('button', { name: 'Сохранить как…' }).click();
    await dlg().locator('#viewName').fill('Для всех');
    await dlg().getByLabel('Вся команда (общее)').check();
    await submit('Сохранить');
    await page.waitForSelector('.view-tab:has-text("Для всех")');
    const v = (await db()).views.find((x) => x.name === 'Для всех');
    eq(v.owner_id, null, 'общее представление должно быть без владельца');
    eq(v.config.compact, true, 'компактный вид сохранён в представлении');
    await page.locator('.view-tab', { hasText: 'Все задачи' }).click();
  });

  // ---------------- капсулы, ссылка, выравнивание, тема, иконки
  await step('AC. значения списка капсулами: меню, выбор, Esc закрывает только меню', async () => {
    await page.locator('.side-item', { hasText: 'Релиз 143' }).click();
    await page.waitForSelector('.board-toolbar');
    await openCard('Выйти из системы');
    const btn = field('Исполнитель').locator('.pill-select-btn');
    await btn.click();
    const names = await page.locator('.pill-menu [role=option]').allInnerTexts();
    ok(names.includes('Борис') && names.includes('Не выбрано'), 'в меню нет нужных пунктов: ' + names.join('|'));
    await shot('card-pill-menu-dark');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pill-menu', { state: 'detached' });
    ok(await page.locator('.dialog.editor').count() > 0, 'Esc закрыл всё окно, а не только меню');
    await choose('Исполнитель', 'Борис');
    await page.waitForFunction(() => document.querySelector('.property .pill-select-btn .pill')?.textContent === 'Борис');
    ok((await db()).task_values.some((v) => v.option_id), 'значение не сохранено');
    await btn.click();
    await dlg().locator('.text-head').click();
    await page.waitForSelector('.pill-menu', { state: 'detached' });
    ok(await page.locator('.dialog.editor').count() > 0, 'клик вне меню внутри окна закрыл окно');
    await closeCard();
  });
  await step('AD. сохранённая ссылка читается ссылкой, карандаш открывает правку', async () => {
    await openCard('Выйти из системы');
    await field('Ссылка').locator('input').fill('https://example.com/login');
    await field('Ссылка').locator('input').blur();
    await page.waitForSelector('.link-text');
    eq(await field('Ссылка').locator('.link-text').count(), 1, 'нет ссылки-текста');
    eq(await field('Ссылка').locator('.link-text').getAttribute('href'), 'https://example.com/login', 'адрес ссылки');
    eq(await field('Ссылка').locator('input').count(), 0, 'при просмотре не должно быть поля ввода');
    await field('Ссылка').getByLabel('Изменить ссылку').click();
    eq(await field('Ссылка').locator('input').inputValue(), 'https://example.com/login', 'в поле правки старое значение');
    await field('Ссылка').locator('input').fill('https://example.org/new');
    await field('Ссылка').locator('input').blur();
    await page.waitForSelector('.link-text[href="https://example.org/new"]');
    await closeCard();
  });
  await step('AE. свойства в карточке выровнены по сетке (названия и значения в одних столбцах)', async () => {
    await openCard('Выйти из системы');
    await dlg().getByRole('radio', { name: /Свойства сверху/ }).click();
    await page.waitForTimeout(300);
    const rows = await dlg().locator('.property').evaluateAll((els) => els.map((e) => {
      const l = e.querySelector('label').getBoundingClientRect(), c = e.querySelector('.property-control').getBoundingClientRect(), r = e.getBoundingClientRect();
      return { labelX: Math.round(l.left), controlX: Math.round(c.left), controlR: Math.round(c.right), h: Math.round(r.height) };
    }));
    ok(rows.length >= 3, 'мало строк для проверки: ' + rows.length);
    eq(new Set(rows.map((r) => r.labelX)).size, 1, 'названия в разных столбцах: ' + JSON.stringify(rows.map((r) => r.labelX)));
    eq(new Set(rows.map((r) => r.controlX)).size, 1, 'значения начинаются по-разному: ' + JSON.stringify(rows.map((r) => r.controlX)));
    eq(new Set(rows.map((r) => r.controlR)).size, 1, 'значения заканчиваются по-разному');
    ok(rows.every((r) => r.h >= 38 && r.h <= 48), 'высоты строк разные: ' + JSON.stringify(rows.map((r) => r.h)));
    await shot('card-properties-grid-dark');
    await closeCard();
  });
  await step('AF. окно управления свойствами выровнено по сетке', async () => {
    await page.getByLabel('Свойства карточек').click();
    await page.waitForSelector('.prop-row');
    const info = await dlg().locator('.prop-row:not(.archived)').evaluateAll((els) => els.map((e) => {
      const q = (sel) => { const n = e.querySelector(sel); if (!n) return null; const b = n.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; };
      return { name: q('input'), badge: q('.type-badge'), eye: q('button[aria-label*="карточках"]'), arch: q('button[aria-label="Убрать в архив"]') };
    }));
    ok(info.length >= 3, 'мало строк: ' + info.length);
    for (const k of ['name', 'badge', 'eye', 'arch']) {
      eq(new Set(info.map((r) => JSON.stringify(r[k]))).size, 1, `столбец «${k}» не выровнен: ` + JSON.stringify(info.map((r) => r[k])));
    }
    await shot('properties-dialog-dark');
    await submit('Готово');
  });
  await step('AG. пользовательская тема: цвета, предупреждение, подбор контраста, сброс', async () => {
    await page.getByLabel('Тема интерфейса').first().click();
    await dlg().getByRole('radio', { name: 'Пользовательская' }).click();
    eq(await dlg().locator('input[type=color]').count(), 6, 'шесть цветовых полей');
    await shot('theme-custom-dark');
    const root = () => page.evaluate(() => ({ resolved: document.documentElement.dataset.resolvedTheme, bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() }));
    await dlg().getByLabel('Фон', { exact: true }).fill('#f6f7fb');
    await dlg().getByLabel('Панели', { exact: true }).fill('#ffffff');
    await dlg().getByLabel('Текст', { exact: true }).fill('#1d2033');
    let r = await root();
    eq(r.resolved, 'light', 'светлый фон должен включить светлую основу');
    eq(r.bg, '#f6f7fb', 'фон применился сразу');
    await shot('theme-custom-light');
    await dlg().getByLabel('Текст', { exact: true }).fill('#e4e6f0');
    await page.waitForSelector('.theme-warning');
    await dlg().getByRole('button', { name: 'Подобрать контраст' }).click();
    await page.waitForSelector('.theme-warning', { state: 'detached' });
    const fixed = JSON.parse(await page.evaluate(() => localStorage.getItem('qaflow.customTheme')));
    ok(fixed.text !== '#e4e6f0', 'цвет текста не изменился после подбора контраста');
    await dlg().getByRole('button', { name: 'Сбросить тему' }).click();
    r = await root();
    eq(r.bg, '#11121b', 'после сброса фон исходный');
    eq(r.resolved, 'dark', 'после сброса тёмная основа');
    await dlg().getByRole('radio', { name: 'Тёмная' }).click();
    eq(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()), '#11121b', 'в тёмной теме фон по умолчанию');
    await closeTheme();
  });
  await step('AH. вместо эмодзи нарисованная корзина в боковой панели', async () => {
    const item = page.locator('.sidebar-footer .side-item');
    eq(await item.locator('svg').count(), 1, 'нет значка-корзины');
    eq((await item.innerText()).trim(), 'Архив и корзина', 'подпись без эмодзи');
    eq(await item.locator('svg path').count(), 4, 'корзина: крышка, ручка, ведро, черта');
    await shot('sidebar-trash-icon');
  });

  // ---------------- окончательное удаление свойств и колонок
  await step('AA. удаление свойства насовсем: счёт значений, ввод названия, каскад', async () => {
    await page.locator('.side-item', { hasText: 'Релиз 143' }).click();
    await page.waitForSelector('.board-toolbar');
    await page.waitForSelector('.task-slot');
    const before = (await db()).tasks.filter((t) => !t.deleted_at).length;
    const prop = (await db()).properties.find((x) => x.name === 'Заметка');
    const valuesBefore = (await db()).task_values.filter((v) => v.property_id === prop.id).length;
    ok(valuesBefore > 0, 'для проверки нужно хотя бы одно значение свойства');
    await page.getByLabel('Свойства карточек').click();
    await page.locator('.prop-row', { has: page.locator('input[value="Заметка"]') }).getByLabel('Убрать в архив').click();
    await dlg().getByRole('button', { name: 'Убрать в архив', exact: true }).click();
    await page.waitForSelector('details.archived summary');
    await page.locator('details.archived summary').click();
    await page.locator('details.archived .prop-row', { hasText: 'Заметка' }).getByRole('button', { name: 'Удалить навсегда' }).click();
    const text = await dlg().innerText();
    ok(text.includes(`${valuesBefore} заполненн`), 'нет числа значений: ' + text.slice(0, 300));
    const confirm = dlg().getByRole('button', { name: 'Удалить свойство и значения' });
    ok(await confirm.isDisabled(), 'кнопка активна без ввода названия');
    await dlg().locator('#dangerPhrase').fill('не то');
    ok(await confirm.isDisabled(), 'кнопка активна при неверном названии');
    await dlg().locator('#dangerPhrase').fill('Заметка');
    await confirm.click();
    await page.waitForFunction((id) => !window.__db.tables.properties.some((p) => p.id === id), prop.id);
    const d = await db();
    ok(!d.task_values.some((v) => v.property_id === prop.id), 'значения свойства остались');
    eq(d.tasks.filter((t) => !t.deleted_at).length, before, 'карточки пострадали');
    await submit('Готово');
  });
  await step('AB. удаление колонки насовсем вместе с карточками', async () => {
    await page.locator('.add-column').click();
    await page.locator('#columnName').fill('Временная');
    await submit('Создать');
    await page.waitForSelector('h3:text-is("Временная")');
    await col('Временная').locator('.add-task').click();
    await col('Временная').getByPlaceholder('Название карточки').fill('Карточка во временной');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.task-title:text-is("Карточка во временной")');
    const others = (await db()).tasks.filter((t) => t.title !== 'Карточка во временной').length;
    await col('Временная').getByLabel('Настроить колонку').click();
    await dlg().getByRole('button', { name: /Убрать колонку в архив/ }).click();
    await page.locator('.dialog').last().getByRole('button', { name: 'Убрать в архив', exact: true }).click();
    await page.waitForSelector('h3:text-is("Временная")', { state: 'detached' });
    await page.locator('.sidebar-footer .side-item').click();
    await page.getByRole('tab', { name: /Колонки/ }).click();
    await page.locator('.archive-row', { hasText: 'Временная' }).getByRole('button', { name: 'Удалить навсегда' }).click();
    await page.waitForFunction(() => document.querySelector('.dialog .confirm-text')?.textContent.includes('1 карточка'));
    const confirm = dlg().getByRole('button', { name: 'Удалить колонку и карточки' });
    ok(await confirm.isDisabled(), 'кнопка активна без ввода названия');
    await dlg().locator('#dangerPhrase').fill('Временная');
    await confirm.click();
    await page.waitForFunction(() => !window.__db.tables.board_columns.some((c) => c.name === 'Временная'));
    const d = await db();
    ok(!d.tasks.some((t) => t.title === 'Карточка во временной'), 'карточка колонки осталась');
    eq(d.tasks.length, others, 'пострадали карточки других колонок');
    await page.waitForSelector('.toast.info:has-text("Колонка удалена вместе с карточками: 1")');
  });


  await step('AI. шаблон сохраняет только структуру доски', async () => {
    await page.locator('.side-item', { hasText: 'Релиз 143' }).click();
    await page.waitForSelector('.board-toolbar');
    await page.waitForSelector('.task-slot');
    await page.getByRole('button', { name: 'Сохранить как шаблон' }).click();
    eq(await page.locator('#boardName').inputValue(), 'Релиз 143', 'шаблон по умолчанию называется как доска');
    await page.locator('#boardName').fill('Релиз шаблон');
    await submit('Сохранить');
    await page.waitForSelector('.toast:has-text("Шаблон сохранён")');
    const t = (await db()).board_templates[0];
    eq(t.name, 'Релиз шаблон', 'название шаблона');
    eq(t.structure.columns.map((c) => c.name), ['Новые', 'В работе', 'Готово'], 'колонки и их порядок');
    eq(t.structure.properties.map((p) => p.name), ['Исполнитель', 'Срок', 'Ссылка'], 'свойства и их порядок');
    ok(!('tasks' in t.structure) && !('values' in t.structure), 'в шаблон попали карточки или значения');
    ok(t.structure.properties[0].options.length === 2, 'варианты списка не сохранились');
  });
  await step('AJ. шаблон: создать доску, применить к существующей, переименовать и удалить', async () => {
    await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
    await page.waitForSelector('h1.board-title:has-text("Шаблоны")');
    await page.waitForSelector('.template-card:has-text("Релиз шаблон")');
    const card = () => page.locator('.template-card').first();
    ok((await card().innerText()).includes('3 колонки'), 'нет сводки по колонкам');
    ok((await card().innerText()).includes('3 свойства'), 'нет сводки по свойствам');

    await card().getByRole('button', { name: 'Создать доску' }).click();
    eq(await page.locator('#boardName').inputValue(), 'Релиз шаблон', 'имя новой доски из шаблона');
    await page.locator('#boardName').fill('Из шаблона');
    await submit('Создать');
    await page.waitForSelector('h1.board-title:has-text("Из шаблона")');
    await page.waitForSelector('.column h3:text-is("Новые")');
    eq(await page.locator('.column').count(), 3, 'колонки новой доски');
    eq(await page.locator('.task-slot').count(), 0, 'в новой доске появились карточки');
    const created = (await db()).boards.find((b) => b.name === 'Из шаблона');
    ok(created, 'доска не создана');
    eq((await db()).board_columns.filter((c) => c.board_id === created.id).length, 3, 'колонки в базе');
    eq((await db()).properties.filter((p) => p.board_id === created.id).length, 3, 'свойства в базе');

    await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
    await page.waitForSelector('.template-card');
    await card().getByRole('button', { name: 'Применить', exact: true }).click();
    await dlg().getByLabel('Доска').selectOption({ label: 'Релиз 143' });
    await submit('Применить');
    await page.waitForSelector('.toast:has-text("Шаблон применён к доске «Релиз 143»")');
    await page.locator('.side-item', { hasText: 'Релиз 143' }).click();
    await page.waitForSelector('.column h3:text-is("Новые (2)")');
    eq(await page.locator('.column').count(), 6, 'применение шаблона добавило колонки в конец');
    const release = (await db()).boards.find((b) => b.name === 'Релиз 143');
    eq(
      (await db()).board_columns.filter((c) => c.board_id === release.id && c.archived_at === null).map((c) => c.name).sort(),
      ['В работе', 'В работе (2)', 'Готово', 'Готово (2)', 'Новые', 'Новые (2)'],
      'имена колонок с суффиксами',
    );
    eq(
      (await db()).properties.filter((p) => p.board_id === release.id && p.archived_at === null).map((p) => p.name).sort(),
      ['Исполнитель', 'Исполнитель (2)', 'Срок', 'Срок (2)', 'Ссылка', 'Ссылка (2)'],
      'имена свойств с суффиксами',
    );

    await page.getByRole('button', { name: 'Шаблоны', exact: true }).click();
    await page.waitForSelector('.template-card');
    await card().getByRole('button', { name: 'Переименовать' }).click();
    await page.locator('#boardName').fill('Шаблон релиза');
    await submit('Сохранить');
    await page.waitForSelector('.template-card:has-text("Шаблон релиза")');
    await card().getByRole('button', { name: 'Удалить' }).click();
    await submit('Удалить шаблон');
    await page.waitForSelector('.toast:has-text("Шаблон удалён")');
    eq((await db()).board_templates.length, 0, 'шаблон не удалён');
    ok((await db()).boards.some((b) => b.name === 'Из шаблона'), 'удаление шаблона затронуло доску');
  });

  await step('Z. после перезагрузки: пользовательская тема, боковая панель и адрес раздела запоминаются', async () => {
    await page.getByLabel('Тема интерфейса').first().click();
    await dlg().getByRole('radio', { name: 'Пользовательская' }).click();
    await dlg().getByLabel('Акцент', { exact: true }).fill('#ff8800');
    await closeTheme();
    await page.getByLabel('Скрыть панель').click();
    await page.waitForSelector('.app-shell.collapsed');
    await page.evaluate(() => { location.hash = '#/archive'; });
    await page.reload();
    await page.waitForSelector('h1.board-title:has-text("Архив и корзина")');
    eq(await page.evaluate(() => document.documentElement.dataset.theme), 'custom', 'режим темы после перезагрузки');
    eq(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#ff8800', 'акцент после перезагрузки');
    await page.waitForSelector('.app-shell.collapsed');
  });
  console.log(results.map((r) => r.join('  ')).join('\n'));
  console.log('\nОШИБКИ БРАУЗЕРА:', problems.length ? '\n' + [...new Set(problems)].join('\n') : 'нет');
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\nИтог: ${results.length - failed} из ${results.length} шагов прошли`);
  process.exitCode = failed > 0 || problems.length > 0 ? 1 : 0;
  await page.screenshot({ path: path.join(OUT, 'final.png') });
  console.log('Файлы и скриншот прогона:', OUT);
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); console.log(results.map((r) => r.join('  ')).join('\n')); process.exit(1); });
