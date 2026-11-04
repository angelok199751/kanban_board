/**
 * Двоичные данные в JSON и обратно: Supabase Realtime Broadcast и таблица task_docs
 * передают состояние Yjs только как текст. base64 добавляет треть размера,
 * зато работает одинаково в браузере и в тестах.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
