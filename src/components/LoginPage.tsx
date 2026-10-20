import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';

export function LoginPage() {
  const { signIn } = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signIn(login, password);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div className="center-screen">
      <form className="card login-card" onSubmit={onSubmit}>
        <div className="logo">✦</div>
        <h1>QA Flow</h1>
        <p className="muted">Вход для команды</p>

        <label className="label" htmlFor="login">Логин</label>
        <input
          id="login"
          className="field"
          autoComplete="username"
          autoCapitalize="none"
          autoFocus
          value={login}
          onChange={(e) => setLogin(e.target.value)}
        />

        <label className="label" htmlFor="password">Пароль</label>
        <input
          id="password"
          className="field"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <div className="error" role="alert">{error}</div>}

        <button className="btn primary wide" type="submit" disabled={busy}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
