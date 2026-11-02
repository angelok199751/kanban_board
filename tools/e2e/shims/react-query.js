// Упрощённая замена @tanstack/react-query: только то, чем пользуется приложение.
import { createContext, createElement, useContext, useEffect, useReducer, useRef } from 'react';

const Ctx = createContext(null);
const hash = (k) => JSON.stringify(k);
export const keepPreviousData = Symbol('keepPreviousData');

export class QueryClient {
  constructor() { this.cache = new Map(); }
  entry(key) {
    const h = hash(key);
    let e = this.cache.get(h);
    if (!e) { e = { key, data: undefined, error: null, status: 'pending', fetching: false, observers: new Set(), fn: null, promise: null, updatedAt: 0 }; this.cache.set(h, e); }
    return e;
  }
  notify(e) { e.observers.forEach((o) => o()); }
  getQueryData(key) { return this.cache.get(hash(key))?.data; }
  setQueryData(key, v) { const e = this.entry(key); e.data = typeof v === 'function' ? v(e.data) : v; e.status = 'success'; e.error = null; this.notify(e); return e.data; }
  async fetch(e) {
    if (!e.fn) return;
    e.fetching = true; this.notify(e);
    const p = e.fn(); e.promise = p;
    try { const d = await p; if (e.promise !== p) return; e.data = d; e.status = 'success'; e.error = null; }
    catch (err) { if (e.promise !== p) return; e.error = err; e.status = 'error'; }
    e.fetching = false; e.updatedAt = Date.now(); this.notify(e);
  }
  invalidateQueries(opts) {
    const prefix = opts && opts.queryKey;
    const jobs = [];
    for (const e of this.cache.values()) {
      if (!prefix || prefix.every((p, i) => hash(e.key[i]) === hash(p))) { e.updatedAt = 0; if (e.observers.size > 0) jobs.push(this.fetch(e)); }
    }
    return Promise.all(jobs).then(() => undefined);
  }
  clear() { this.cache.clear(); }
}

export function QueryClientProvider({ client, children }) { return createElement(Ctx.Provider, { value: client }, children); }
export function useQueryClient() { return useContext(Ctx); }

export function useQuery(opts) {
  const qc = useContext(Ctx);
  const [, force] = useReducer((x) => x + 1, 0);
  const e = qc.entry(opts.queryKey);
  e.fn = opts.queryFn;
  const enabled = opts.enabled !== false;
  const prev = useRef(undefined);

  useEffect(() => {
    const o = () => force();
    e.observers.add(o);
    if (enabled && !e.fetching && (e.status === 'pending' || e.updatedAt === 0)) qc.fetch(e);
    return () => { e.observers.delete(o); };
  }, [hash(opts.queryKey), enabled]);

  let data = e.data;
  if (data === undefined && opts.placeholderData === keepPreviousData) data = prev.current;
  if (e.data !== undefined) prev.current = e.data;
  return {
    data,
    error: e.error,
    isLoading: enabled && e.status === 'pending',
    isError: e.status === 'error',
    isSuccess: e.status === 'success',
    refetch: () => qc.fetch(e),
  };
}
