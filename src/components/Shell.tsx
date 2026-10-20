import { useEffect, useState } from 'react';
import { useAuth, type Member } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { ChangePasswordDialog } from './ChangePasswordDialog';

type DbCheck = { kind: 'loading' } | { kind: 'ok'; boards: number } | { kind: 'error'; message: string };

export function Shell({ member }: { member: Member }) {
  const { signOut } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [db, setDb] = useState<DbCheck>({ kind: 'loading' });

  // Проверка связи и прав: считаем доски, которые видит текущий пользователь.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('boards')
      .select('id', { count: 'exact', head: true })
      .then(({ count, error }) => {
        if (cancelled) return;
        setDb(error ? { kind: 'error', message: error.message } : { kind: 'ok', boards: count ?? 0 });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo small">✦</div>
          <h1>QA Flow</h1>
        </div>
        <div className="row">
          <span className="muted">
            {member.display_name}
            {member.role === 'admin' ? ' · админ' : ''}
          </span>
          <button className="btn small" type="button" onClick={() => setShowPassword(true)}>Сменить пароль</button>
          <button className="btn small" type="button" onClick={() => void signOut()}>Выйти</button>
        </div>
      </header>

      <main className="card placeholder">
        <h2>Основа готова ✔</h2>
        <p className="muted">
          Вход работает. Доски, колонки и карточки появятся на следующем этапе.
        </p>
        <p className="muted">
          Связь с базой:{' '}
          {db.kind === 'loading' && 'проверяем…'}
          {db.kind === 'ok' && `в порядке (досок: ${db.boards})`}
          {db.kind === 'error' && <span className="error-inline">ошибка — {db.message}</span>}
        </p>
      </main>

      {showPassword && <ChangePasswordDialog onClose={() => setShowPassword(false)} />}
    </div>
  );
}
