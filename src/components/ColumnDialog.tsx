import { useState } from 'react';
import { COLORS, COLOR_NAMES } from '../lib/colors';
import type { ColorName } from '../lib/types';
import { FormDialog } from './Dialog';

export function ColumnDialog({
  title,
  submitLabel,
  initialName = '',
  initialColor = 'gray',
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initialName?: string;
  initialColor?: ColorName;
  onSubmit: (name: string, color: ColorName) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<ColorName>(initialColor);

  return (
    <FormDialog
      title={title}
      submitLabel={submitLabel}
      onClose={onClose}
      onSubmit={() => onSubmit(name, color)}
      disabled={name.trim() === ''}
    >
      <label className="label" htmlFor="columnName">Название колонки</label>
      <input id="columnName" className="field" maxLength={60} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <div className="label">Цвет</div>
      <div className="swatches" role="radiogroup" aria-label="Цвет колонки">
        {COLOR_NAMES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === color}
            aria-label={c}
            className={c === color ? 'swatch selected' : 'swatch'}
            style={{ background: COLORS[c] }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
    </FormDialog>
  );
}
