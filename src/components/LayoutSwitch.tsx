import type { ReactElement } from 'react';

export type CardLayout = 'top' | 'left' | 'right';

export const parseLayout = (raw: string): CardLayout | null => (raw === 'top' || raw === 'left' || raw === 'right' ? raw : null);

const OPTIONS: { value: CardLayout; label: string; icon: ReactElement }[] = [
  {
    value: 'top',
    label: 'Свойства сверху, текст ниже',
    icon: (
      <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
        <rect x="1" y="1" width="16" height="12" rx="2" fill="none" stroke="currentColor" />
        <rect x="1" y="1" width="16" height="5" rx="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    value: 'left',
    label: 'Свойства слева, текст справа',
    icon: (
      <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
        <rect x="1" y="1" width="16" height="12" rx="2" fill="none" stroke="currentColor" />
        <rect x="1" y="1" width="6.5" height="12" rx="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    value: 'right',
    label: 'Свойства справа, текст слева',
    icon: (
      <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
        <rect x="1" y="1" width="16" height="12" rx="2" fill="none" stroke="currentColor" />
        <rect x="10.5" y="1" width="6.5" height="12" rx="1.5" fill="currentColor" />
      </svg>
    ),
  },
];

/** Переключатель вида окна карточки: свойства сверху, слева или справа. Выбор запоминается в этом браузере. */
export function LayoutSwitch({ value, onChange }: { value: CardLayout; onChange: (layout: CardLayout) => void }) {
  return (
    <div className="layout-switch" role="radiogroup" aria-label="Вид карточки">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
