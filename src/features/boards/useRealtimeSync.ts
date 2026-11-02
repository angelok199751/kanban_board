import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { staleKeysFor, SYNCED_TABLES } from '../../lib/sync';

export type SyncStatus = 'connecting' | 'online' | 'offline';

/**
 * Синхронизация между открытыми вкладками участников.
 * Любое изменение в таблицах доски помечает данные устаревшими, и они читаются заново (с паузой 300 мс,
 * чтобы пачка изменений дала один запрос). После потери связи и её возвращения всё перечитывается целиком,
 * поэтому пропущенные изменения не теряются и не дублируются.
 * Возвращает состояние связи для индикатора.
 */
export function useRealtimeSync(): SyncStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SyncStatus>(() => (navigator.onLine ? 'connecting' : 'offline'));

  useEffect(() => {
    const pending = new Set<string>();
    let timer: number | undefined;

    const flush = () => {
      timer = undefined;
      const keys = [...pending];
      pending.clear();
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key] });
    };
    const schedule = (keys: string[]) => {
      for (const key of keys) pending.add(key);
      if (timer === undefined) timer = window.setTimeout(flush, 300);
    };

    const channel = supabase.channel('qaflow-sync');
    for (const table of SYNCED_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => schedule(staleKeysFor(table)));
    }

    let wasSubscribed = false;
    channel.subscribe((s: string) => {
      if (s === 'SUBSCRIBED') {
        setStatus('online');
        // это повторное подключение: что-то могло измениться, пока связи не было
        if (wasSubscribed) void queryClient.invalidateQueries();
        wasSubscribed = true;
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
        setStatus('offline');
      }
    });

    const onOffline = () => setStatus('offline');
    const onOnline = () => {
      setStatus('connecting');
      void queryClient.invalidateQueries();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return status;
}
