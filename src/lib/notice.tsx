import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface NoticeApi {
  notify: (message: string) => void;
}

const NoticeContext = createContext<NoticeApi>({ notify: () => undefined });

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const notify = useCallback((text: string) => {
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 7000);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <NoticeContext.Provider value={{ notify }}>
      {children}
      {message && (
        <div className="toast" role="alert" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}
    </NoticeContext.Provider>
  );
}

export function useNotice(): NoticeApi {
  return useContext(NoticeContext);
}
