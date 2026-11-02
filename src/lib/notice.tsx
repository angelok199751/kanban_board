import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface NoticeApi {
  /** tone: 'error' (по умолчанию) или 'info' для обычных сообщений. */
  notify: (message: string, tone?: 'error' | 'info') => void;
}

const NoticeContext = createContext<NoticeApi>({ notify: () => undefined });

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const notify = useCallback((text: string, tone: 'error' | 'info' = 'error') => {
    setMessage({ text, tone });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 7000);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <NoticeContext.Provider value={{ notify }}>
      {children}
      {message && (
        <div className={message.tone === 'info' ? 'toast info' : 'toast'} role={message.tone === 'info' ? 'status' : 'alert'} onClick={() => setMessage(null)}>
          {message.text}
        </div>
      )}
    </NoticeContext.Provider>
  );
}

export function useNotice(): NoticeApi {
  return useContext(NoticeContext);
}
