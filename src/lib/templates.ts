import { COLOR_NAMES } from './colors';
import { compareByPosition } from './positions';
import type { BoardData, ColorName, PropertyType } from './types';

/** Колонка в шаблоне: имя, цвет и порядок (порядок задаётся позицией в массиве). */
export interface TemplateColumn {
  name: string;
  color: ColorName;
}

/** Вариант выпадающего списка в шаблоне. */
export interface TemplateOption {
  label: string;
  color: ColorName;
}

/** Свойство в шаблоне: тип, режим списка и видимость на карточке. */
export interface TemplateProperty {
  name: string;
  type: PropertyType;
  multiple: boolean;
  hidden: boolean;
  options: TemplateOption[];
}

/** Всё, что переносится из доски в шаблон. Карточки и значения сюда не входят. */
export interface BoardTemplateStructure {
  columns: TemplateColumn[];
  properties: TemplateProperty[];
}

/** Шаблон доски, сохранённый в базе. */
export interface BoardTemplate {
  id: string;
  name: string;
  structure: BoardTemplateStructure;
  created_at: string;
  updated_at: string;
}

const MAX_NAME = 60;
const MAX_TEMPLATE_NAME = 100;
const TYPES: readonly PropertyType[] = ['select', 'text', 'url', 'date'];
const COLORS = new Set<string>(COLOR_NAMES);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

const colorOf = (v: unknown): ColorName => (typeof v === 'string' && COLORS.has(v) ? (v as ColorName) : 'gray');

const typeOf = (v: unknown): PropertyType =>
  typeof v === 'string' && (TYPES as readonly string[]).includes(v) ? (v as PropertyType) : 'text';

/** Обрезает имя до ограничения базы и убирает пустые значения. */
const cleanName = (v: unknown, max = MAX_NAME): string => text(v).trim().slice(0, max);

/**
 * Приводит структуру из базы или из старого шаблона к безопасному виду.
 * Неизвестные типы и цвета заменяются на нейтральные, повторы имён убираются,
 * варианты остаются только у списков.
 */
export function normalizeStructure(raw: unknown): BoardTemplateStructure {
  if (!isRecord(raw)) return { columns: [], properties: [] };

  const columns: TemplateColumn[] = [];
  const columnNames = new Set<string>();
  for (const item of Array.isArray(raw.columns) ? raw.columns : []) {
    if (!isRecord(item)) continue;
    const name = cleanName(item.name);
    const key = name.toLowerCase();
    if (name === '' || columnNames.has(key)) continue;
    columnNames.add(key);
    columns.push({ name, color: colorOf(item.color) });
  }

  const properties: TemplateProperty[] = [];
  const propertyNames = new Set<string>();
  for (const item of Array.isArray(raw.properties) ? raw.properties : []) {
    if (!isRecord(item)) continue;
    const name = cleanName(item.name);
    const key = name.toLowerCase();
    if (name === '' || propertyNames.has(key)) continue;
    propertyNames.add(key);

    const type = typeOf(item.type);
    const options: TemplateOption[] = [];
    if (type === 'select') {
      const optionNames = new Set<string>();
      for (const option of Array.isArray(item.options) ? item.options : []) {
        if (!isRecord(option)) continue;
        const label = cleanName(option.label);
        const optionKey = label.toLowerCase();
        if (label === '' || optionNames.has(optionKey)) continue;
        optionNames.add(optionKey);
        options.push({ label, color: colorOf(option.color) });
      }
    }

    properties.push({
      name,
      type,
      multiple: type === 'select' && item.multiple === true,
      hidden: item.hidden === true,
      options,
    });
  }

  return { columns, properties };
}

/**
 * Снимок структуры доски. Архивные колонки и свойства не попадают в шаблон,
 * порядок берётся из position, идентификаторы и карточки отбрасываются.
 */
export function structureFromBoard(data: BoardData): BoardTemplateStructure {
  const columns = data.columns
    .filter((c) => c.archived_at === null)
    .sort(compareByPosition)
    .map((c) => ({ name: c.name, color: c.color }));

  const properties = data.properties
    .filter((p) => p.archived_at === null)
    .sort(compareByPosition)
    .map((p) => ({
      name: p.name,
      type: p.type,
      multiple: p.multiple,
      hidden: p.hidden,
      options:
        p.type === 'select'
          ? data.options
              .filter((o) => o.property_id === p.id)
              .sort(compareByPosition)
              .map((o) => ({ label: o.label, color: o.color }))
          : [],
    }));

  return normalizeStructure({ columns, properties });
}

/**
 * Имя без конфликта: если такое уже есть, добавляем « (2)», « (3)» и так далее.
 * Сравнение без учёта регистра и пробелов по краям, как в ограничениях базы.
 */
export function uniqueName(name: string, existing: Iterable<string>): string {
  const base = name.trim();
  const used = new Set([...existing].map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;

  for (let i = 2; ; i += 1) {
    const suffix = ` (${i})`;
    const candidate = `${base.slice(0, MAX_NAME - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Название шаблона по имени доски: «Релиз» → «Релиз». */
export const cleanTemplateName = (name: string): string => name.trim().slice(0, MAX_TEMPLATE_NAME);
