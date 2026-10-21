import { useEffect, useState } from 'react';
import { isValidUrl } from '../lib/format';
import { compareByPosition } from '../lib/positions';
import { humanizeError } from '../lib/supabase';
import type { Property, PropertyOption, TaskValue } from '../lib/types';

/**
 * Поле значения свойства в окне карточки. Сохраняется само:
 * список и дата сразу при выборе, текст и ссылка при выходе из поля.
 * onSave получает null (очистить), id варианта, текст или 'YYYY-MM-DD'.
 */
export function PropertyField({
  property,
  options,
  value,
  onSave,
}: {
  property: Property;
  options: PropertyOption[];
  value: TaskValue | undefined;
  onSave: (raw: string | null) => Promise<void>;
}) {
  const saved = property.type === 'date' ? (value?.value_date ?? '') : (value?.value_text ?? '');
  const [text, setText] = useState(saved);
  const [error, setError] = useState<string | null>(null);

  // подхватываем изменения, пришедшие с сервера (например, от другого участника)
  useEffect(() => setText(saved), [saved]);

  async function save(raw: string | null) {
    setError(null);
    try {
      await onSave(raw);
    } catch (e) {
      setError(humanizeError(e instanceof Error ? e.message : String(e)));
    }
  }

  function commitText() {
    const v = text.trim();
    if (v === saved) return;
    // формат ссылки проверяет база: ошибка попадает в статус окна, и введённое не теряется при закрытии
    void save(v === '' ? null : v);
  }

  let control;
  if (property.type === 'select') {
    const list = options.filter((o) => o.property_id === property.id).sort(compareByPosition);
    control = (
      <select
        className="field"
        value={value?.option_id ?? ''}
        onChange={(e) => void save(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">Не выбрано</option>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (property.type === 'date') {
    control = (
      <input
        className="field"
        type="date"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          void save(e.target.value === '' ? null : e.target.value);
        }}
      />
    );
  } else {
    control = (
      <div className="field-with-link">
        <input
          className="field"
          type="text"
          maxLength={property.type === 'url' ? 2000 : 500}
          placeholder={property.type === 'url' ? 'https://…' : ''}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {property.type === 'url' && saved !== '' && isValidUrl(saved) && (
          <a className="btn small" href={saved} target="_blank" rel="noopener noreferrer">
            Открыть ↗
          </a>
        )}
      </div>
    );
  }

  return (
    <>
      {control}
      {error && (
        <div className="error small-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
