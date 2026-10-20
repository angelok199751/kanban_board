import { AuthProvider, useAuth } from './auth/AuthProvider';
import { LoginPage } from './components/LoginPage';
import { Shell } from './components/Shell';
import { isConfigured } from './config';

function Gate() {
  const { state, signOut, retry } = useAuth();

  switch (state.status) {
    case 'loading':
      return <div className="center-screen muted">Загрузка…</div>;
    case 'signed_out':
      return <LoginPage />;
    case 'denied':
      return (
        <div className="center-screen">
          <div className="card login-card">
            <h2>Доступ отключён</h2>
            <p className="muted">Этой учётной записи нет в списке активных участников команды.</p>
            <button className="btn" type="button" onClick={() => void signOut()}>Выйти</button>
          </div>
        </div>
      );
    case 'error':
      return (
        <div className="center-screen">
          <div className="card login-card">
            <h2>Не удалось проверить доступ</h2>
            <div className="error">{state.message}</div>
            <div className="row">
              <button className="btn primary" type="button" onClick={retry}>Повторить</button>
              <button className="btn" type="button" onClick={() => void signOut()}>Выйти</button>
            </div>
          </div>
        </div>
      );
    case 'ready':
      return <Shell member={state.member} />;
  }
}

export default function App() {
  if (!isConfigured) {
    return (
      <div className="center-screen">
        <div className="card login-card">
          <h2>Не заполнены настройки</h2>
          <p className="muted">
            Открой файл <code>src/config.ts</code> и впиши публичный ключ Supabase и домен для логинов.
          </p>
        </div>
      </div>
    );
  }
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
