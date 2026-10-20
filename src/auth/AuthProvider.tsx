import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, humanizeError } from '../lib/supabase';
import { LOGIN_DOMAIN } from '../config';

export interface Member {
  user_id: string;
  display_name: string;
  role: 'admin' | 'member';
  is_active: boolean;
}

type MemberState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; member: Member }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'denied' }
  | { status: 'error'; message: string }
  | { status: 'ready'; session: Session; member: Member };

interface AuthContextValue {
  state: AuthState;
  signIn: (login: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** «anna» → «anna@домен»; если введён полный адрес — используем как есть. */
export function loginToEmail(login: string): string {
  const v = login.trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${LOGIN_DOMAIN}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined — ещё не знаем; null — не вошли
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [memberState, setMemberState] = useState<MemberState>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null));

    // Внутри колбэка не обращаемся к базе: загрузка участника — в отдельном эффекте ниже.
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) {
      setMemberState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    setMemberState({ kind: 'loading' });
    supabase
      .from('members')
      .select('user_id, display_name, role, is_active')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setMemberState({ kind: 'error', message: humanizeError(error.message) });
        else if (!data || !data.is_active) setMemberState({ kind: 'denied' });
        else setMemberState({ kind: 'ok', member: data as Member });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  const signIn = useCallback(async (login: string, password: string) => {
    if (!login.trim() || !password) return 'Введи логин и пароль.';
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginToEmail(login),
        password,
      });
      return error ? humanizeError(error.message) : null;
    } catch (e) {
      return humanizeError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const state: AuthState = useMemo(() => {
    if (session === undefined) return { status: 'loading' };
    if (session === null) return { status: 'signed_out' };
    switch (memberState.kind) {
      case 'ok':
        return { status: 'ready', session, member: memberState.member };
      case 'denied':
        return { status: 'denied' };
      case 'error':
        return { status: 'error', message: memberState.message };
      default:
        return { status: 'loading' };
    }
  }, [session, memberState]);

  const value = useMemo(() => ({ state, signIn, signOut, retry }), [state, signIn, signOut, retry]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth должен вызываться внутри AuthProvider');
  return ctx;
}
