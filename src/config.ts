// ВАЖНО: сюда можно вставлять только ПУБЛИЧНЫЕ значения.
// Секретный ключ (service_role / secret) сюда нельзя — никогда.

// Project URL из Supabase → Project Settings → API
export const SUPABASE_URL = 'https://kpwsonthpczijvcesgnj.supabase.co';

// Публичный ключ: «anon» или «publishable» (Project Settings → API)
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_iBnui6f5O3Dk2t7zRY2F0w_HxLS-V3-';

// Домен, который добавляется к логину при входе: логин «anna» → anna@ЭТОТ_ДОМЕН.
// Должен совпадать с тем, что ты использовала при создании пользователей.
export const LOGIN_DOMAIN = '@qa.flow';

export const isConfigured =
  !SUPABASE_PUBLISHABLE_KEY.startsWith('ВСТАВЬ') && !LOGIN_DOMAIN.startsWith('ВСТАВЬ');
