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

export interface BoardData {
  columns: Column[];
  tasks: Task[];
}
