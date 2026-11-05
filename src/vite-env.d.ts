/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Адрес Supabase или прокси к нему; нужен для сборки зеркала. */
  readonly VITE_SUPABASE_URL?: string;
}
