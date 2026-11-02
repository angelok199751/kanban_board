// Упрощённая версия алгоритма fractional indexing (ключи из 0-9A-Za-z); так же бросает ошибку, если a >= b.
const D = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function midpoint(a, b) {
  if (b !== null) { let n = 0; while ((a[n] || '0') === b[n]) n++; if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n)); }
  const da = a ? D.indexOf(a[0]) : 0; const db = b !== null ? D.indexOf(b[0]) : D.length;
  if (db - da > 1) return D[Math.round(0.5 * (da + db))];
  if (b && b.length > 1) return b.slice(0, 1);
  return D[da] + midpoint(a.slice(1), null);
}
export function generateKeyBetween(a, b) {
  if (a != null && b != null && a >= b) throw new Error(`${a} >= ${b}`);
  return midpoint(a ?? '', b ?? null);
}
export function generateNKeysBetween(a, b, n) {
  if (n === 0) return [];
  if (n === 1) return [generateKeyBetween(a, b)];
  const mid = Math.floor(n / 2);
  const c = generateKeyBetween(a, b);
  return [...generateNKeysBetween(a, c, mid), c, ...generateNKeysBetween(c, b, n - mid - 1)];
}
