export type ColorName = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'gray';

export interface Board {
  id: string;
  name: string;
  description: string | null;
  position: string;
  archived_at: string | null;
}

export interface Column {
  id: string;
  board_id: string;
  name: string;
  color: ColorName;
  position: string;
  archived_at: string | null;
}

export interface Task {
  id: string;
  board_id: string;
  column_id: string;
  number: number;
  title: string;
  position: string;
  version: number;
  archived_at: string | null;
  deleted_at: string | null;
}

export type PropertyType = 'select' | 'text' | 'url' | 'date';

export interface Property {
  id: string;
  board_id: string;
  name: string;
  type: PropertyType;
  /** Список разрешает несколько выбранных вариантов. Для остальных типов всегда false. */
  multiple: boolean;
  position: string;
  hidden: boolean;
  archived_at: string | null;
}

export interface PropertyOption {
  id: string;
  property_id: string;
  label: string;
  color: ColorName;
  position: string;
}

/** Значение свойства у задачи. Заполнено ровно одно поле, зависящее от типа свойства. */
export interface TaskValue {
  task_id: string;
  property_id: string;
  value_text: string | null;
  value_date: string | null; // 'YYYY-MM-DD', без часового пояса
  option_id: string | null; // одиночный список: один вариант
  option_ids: string[]; // список с несколькими значениями
  updated_at: string; // версия значения: по ней проверяем, что его не изменили до нас
}

export interface BoardData {
  columns: Column[];
  tasks: Task[];
  properties: Property[]; // включая архивные
  options: PropertyOption[];
  values: TaskValue[];
}

/** Сохранённое представление доски: общее (owner_id пустой) или личное. */
export interface SavedView {
  id: string;
  board_id: string;
  owner_id: string | null;
  name: string;
  config: unknown;
  position: string;
}

/** Полная карточка (с описанием) для окна редактирования. */
export interface TaskFull {
  id: string;
  title: string;
  description_html: string;
  version: number;
}

/** Карточка для экспорта: с описанием и признаками архива и корзины. */
export interface ExportTask {
  id: string;
  column_id: string;
  number: number;
  title: string;
  description_html: string;
  position: string;
  archived_at: string | null;
  deleted_at: string | null;
}

// ---------------------------------------------------------------- базы знаний

export interface KnowledgeBase {
  id: string;
  name: string;
  position: string;
  archived_at: string | null;
}

/** Статья в списке: без HTML, но с текстом для поиска и отрывка. */
export interface KnowledgeArticle {
  id: string;
  base_id: string;
  title: string;
  labels: string[];
  version: number;
  updated_at: string;
  deleted_at: string | null;
  search_text: string;
}

/** Полная статья для окна редактирования. */
export interface ArticleFull {
  id: string;
  title: string;
  labels: string[];
  content_html: string;
  version: number;
}
