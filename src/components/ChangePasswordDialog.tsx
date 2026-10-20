import { useState, type FormEvent } from 'react';
import { supabase, humanizeError } from '../lib/supabase';

const MIN_LENGTH = 10;

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw1.length < MIN_LENGTH) return setError(`Пароль должен быть не короче ${MIN_LENGTH} символов.`);
    if (pw1 !== pw2) return setError('Пароли не совпадают.');
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: pw1 });
      if (err) setError(humanizeError(err.message));
      else setDone(true);
    } catch (e2) {
      setError(humanizeError(e2 instanceof Error ? e2.message : String(e2)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card dialog" onSubmit={onSubmit} role="dialog" aria-modal="true" aria-labelledby="pwTitle">
        <h2 id="pwTitle">Смена пароля</h2>
        {done ? (
          <>
            <p>Пароль изменён.</p>
            <button className="btn primary" type="button" onClick={onClose}>Закрыть</button>
          </>
        ) : (
          <>
            <label className="label" htmlFor="pw1">Новый пароль</label>
            <input id="pw1" className="field" type="password" autoComplete="new-password"
                   value={pw1} onChange={(e) => setPw1(e.target.value)} autoFocus />
            <label className="label" htmlFor="pw2">Повтори новый пароль</label>
            <input id="pw2" className="field" type="password" autoComplete="new-password"
                   value={pw2} onChange={(e) => setPw2(e.target.value)} />
            {error && <div className="error" role="alert">{error}</div>}
            <div className="row">
              <button className="btn" type="button" onClick={onClose}>Отмена</button>
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
