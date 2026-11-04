/**
 * Цвет участника для курсора и значка присутствия.
 * Одинаковый для одного и того же человека в разных вкладках и на разных устройствах.
 * Только #rrggbb: Tiptap проверяет цвет курсора строгим шаблоном.
 */
const COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#ea580c',
  '#4f46e5',
  '#0d9488',
  '#9333ea',
];

export function colorForUser(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}
