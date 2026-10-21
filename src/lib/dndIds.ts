// Колонки и карточки делят один DndContext, поэтому их идентификаторы различаются префиксом.
export const columnDndId = (id: string) => `col:${id}`;
export const taskDndId = (id: string) => `task:${id}`;
export const isColumnDndId = (id: string) => id.startsWith('col:');
export const isTaskDndId = (id: string) => id.startsWith('task:');
export const rawId = (dndId: string) => dndId.slice(dndId.indexOf(':') + 1);
