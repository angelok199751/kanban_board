// Иконки интерфейса: контурные, цвет берут у текста (currentColor).
interface IconProps {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/** Корзина: крышка с ручкой, сужающееся ведро и короткая черта внутри. */
export function IconTrash({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3.5 6.5h17" />
      <path d="M9 6.5l.6-2.7h4.8L15 6.5" />
      <path d="M5.8 6.5L6.9 20h10.2l1.1-13.5" />
      <path d="M10 16.5h4" />
    </svg>
  );
}

/** Шаблон: два листа со смещением (копия структуры). */
export function IconTemplate({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3.5" y="3.5" width="12" height="12" rx="2" />
      <path d="M8.5 20.5h10a2 2 0 0 0 2-2v-10" />
    </svg>
  );
}

/** Архив: коробка с крышкой. */
export function IconArchive({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="4.5" rx="1.2" />
      <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5" />
      <path d="M10 12.5h4" />
    </svg>
  );
}
