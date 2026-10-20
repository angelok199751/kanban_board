// ВАЖНО: сюда можно вставлять только ПУБЛИЧНЫЕ значения.
// Секретный ключ (service_role / secret) сюда нельзя — никогда.

// Project URL из Supabase → Project Settings → API
export const SUPABASE_URL = 'https://kpwsonthpczijvcesgnj.supabase.co';

// Публичный ключ: «anon» или «publishable» (Project Settings → API)
export const SUPABASE_PUBLISHABLE_KEY = 'ВСТАВЬ_СЮДА_ПУБЛИЧНЫЙ_КЛЮЧ';

// Домен, который добавляется к логину при входе: логин «anna» → anna@ЭТОТ_ДОМЕН.
// Должен совпадать с тем, что ты использовала при создании пользователей.
export const LOGIN_DOMAIN = 'ВСТАВЬ_СЮДА_ДОМЕН';

export const isConfigured =
  !SUPABASE_PUBLISHABLE_KEY.startsWith('ВСТАВЬ') && !LOGIN_DOMAIN.startsWith('ВСТАВЬ');
