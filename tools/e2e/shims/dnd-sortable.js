import { createElement, Fragment } from 'react';
export const arrayMove = (a, from, to) => { const c = [...a]; const [x] = c.splice(from, 1); c.splice(to, 0, x); return c; };
export const horizontalListSortingStrategy = {};
export const verticalListSortingStrategy = {};
export const sortableKeyboardCoordinates = () => null;
export function SortableContext({ children }) { return createElement(Fragment, null, children); }
export function useSortable() { return { attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, transition: undefined, isDragging: false }; }
