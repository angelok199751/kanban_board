// Заглушка @dnd-kit/core: обработчики перетаскивания доступны тестам через window.__dnd
import { createElement, Fragment } from 'react';
export const closestCenter = () => [];
export const pointerWithin = () => [];
export const rectIntersection = () => [];
export class PointerSensor {}
export class KeyboardSensor {}
export const useSensor = () => ({});
export const useSensors = () => [];
export function DndContext(props) {
  window.__dnd = { onDragStart: props.onDragStart, onDragOver: props.onDragOver, onDragEnd: props.onDragEnd, onDragCancel: props.onDragCancel };
  return createElement(Fragment, null, props.children);
}
export function DragOverlay() { return null; }
