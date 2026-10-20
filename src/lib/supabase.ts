import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Адрес страницы в дальнейшем будет использоваться под маршруты (#/...),
    // поэтому разбор токенов из URL отключён.
    detectSessionInUrl: false,
  },
});

/** Приводит сообщение об ошибке к понятному русскому тексту. */
export function humanizeError(message: string | undefined | null): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'Неверный логин или пароль.';
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network request failed')) {
    return 'Нет связи с сервером. Проверь интернет и попробуй ещё раз.';
  }
  if (m.includes('same password') || m.includes('different from the old')) {
    return 'Новый пароль должен отличаться от текущего.';
  }
  if (m.includes('reauthentication') || m.includes('recently')) {
    return 'Для смены пароля нужно заново войти: выйди и войди снова.';
  }
  return message || 'Что-то пошло не так.';
}
