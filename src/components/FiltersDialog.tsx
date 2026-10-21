import { compareByPosition } from '../lib/positions';
import type { Property, PropertyOption } from '../lib/types';
import { isFilterActive, type PropFilter, type ViewConfig } from '../lib/viewConfig';
import { Dialog } from './Dialog';

/** Фильтры по свойствам. Изменения действуют сразу; все условия работают вместе (И). */
export function FiltersDialog({
  properties,
  options,
  config,
  onChange,
  onClose,
}: {
  properties: Property[];
  options: PropertyOption[];
  config: ViewConfig;
  onChange: (filters: ViewConfig['filters']) => void;
  onClose: () => void;
}) {
  const set = (propertyId: string, next: PropFilter) => {
    const filters = { ...config.filters };
    if (isFilterActive(next)) filters[propertyId] = next;
    else delete filters[propertyId];
    onChange(filters);
  };
  const anyActive = Object.values(config.filters).some(isFilterActive);

  return (
    <Dialog title="Фильтры" wide onClose={onClose}>
      {properties.length === 0 && <p className="muted">Фильтровать пока не по чему: сначала добавь свойства.</p>}

      <div className="filter-list">
        {properties.map((p) => {
          const f = config.filters[p.id] ?? {};
          return (
            <div key={p.id} className="filter-block">
              <div className="label">{p.name}</div>

              {p.type === 'select' && (
                <div className="check-list">
                  {options
                    .filter((o) => o.property_id === p.id)
                    .sort(compareByPosition)
                    .map((o) => {
                      const checked = (f.optionIds ?? []).includes(o.id);
                      return (
                        <label key={o.id} className="check-line">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const ids = new Set(f.optionIds ?? []);
                              if (checked) ids.delete(o.id);
                              else ids.add(o.id);
                              set(p.id, { ...f, optionIds: [...ids] });
                            }}
                          />
                          {o.label}
                        </label>
                      );
                    })}
                  <label className="check-line">
                    <input type="checkbox" checked={f.empty === true} onChange={() => set(p.id, { ...f, empty: f.empty !== true })} />
                    <span className="muted">Не задано</span>
                  </label>
                </div>
              )}

              {(p.type === 'text' || p.type === 'url') && (
                <input
                  className="field"
                  placeholder="Содержит…"
                  value={f.contains ?? ''}
                  onChange={(e) => set(p.id, { ...f, contains: e.target.value })}
                />
              )}

              {p.type === 'date' && (
                <div className="date-range">
                  <label className="muted small-text">
                    С <input className="field" type="date" value={f.from ?? ''} onChange={(e) => set(p.id, { ...f, from: e.target.value })} />
                  </label>
                  <label className="muted small-text">
                    По <input className="field" type="date" value={f.to ?? ''} onChange={(e) => set(p.id, { ...f, to: e.target.value })} />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="row end">
        <button className="btn" type="button" disabled={!anyActive} onClick={() => onChange({})}>
          Сбросить все фильтры
        </button>
        <button className="btn primary" type="button" onClick={onClose}>
          Готово
        </button>
      </div>
    </Dialog>
  );
}
