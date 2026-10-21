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
  option_id: string | null;
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
