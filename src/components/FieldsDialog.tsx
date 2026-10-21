import type { Property } from '../lib/types';
import { isShownOnCard, type ViewConfig } from '../lib/viewConfig';
import { Dialog } from './Dialog';

/** Какие свойства показывать на карточках в этом представлении. */
export function FieldsDialog({
  properties,
  config,
  onChange,
  onClose,
}: {
  properties: Property[];
  config: ViewConfig;
  onChange: (cardProps: string[] | null) => void;
  onClose: () => void;
}) {
  const shown = properties.filter((p) => isShownOnCard(p, config)).map((p) => p.id);

  const toggle = (id: string) => {
    const set = new Set(shown);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange(properties.filter((p) => set.has(p.id)).map((p) => p.id));
  };

  return (
    <Dialog title="Поля на карточках" onClose={onClose}>
      <p className="muted small-note">Отметь свойства, которые видны на карточках в этом представлении. В окне карточки видны все.</p>
      <div className="check-list">
        {properties.length === 0 && <div className="muted">Свойств пока нет.</div>}
        {properties.map((p) => (
          <label key={p.id} className="check-line">
            <input type="checkbox" checked={shown.includes(p.id)} onChange={() => toggle(p.id)} />
            {p.name}
          </label>
        ))}
      </div>
      <div className="row end">
        <button className="btn" type="button" disabled={config.cardProps === null} onClick={() => onChange(null)}>
          Как в настройках свойств
        </button>
        <button className="btn primary" type="button" onClick={onClose}>
          Готово
        </button>
      </div>
    </Dialog>
  );
}
