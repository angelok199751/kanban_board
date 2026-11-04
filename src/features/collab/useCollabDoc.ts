import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { fromBase64, toBase64 } from '../../lib/base64';
import { humanizeError, supabase } from '../../lib/supabase';
import * as api from '../boards/api';
import {
  peersOf,
  SupabaseYjsProvider,
  type CollabStatus,
  type CollabUser,
  type ProviderChannel,
} from './provider';
import { htmlToYState } from './taskDoc';

const SAVE_DELAY_MS = 800;

export type CollabDocKind = 'task' | 'article';

/** Набор операций с таблицей снимков: карточки и статьи устроены одинаково. */
function docApiFor(kind: CollabDocKind) {
  return kind === 'article'
    ? { get: api.getArticleDocState, create: api.createArticleDocState, save: api.saveArticleDocState, room: 'article-doc' }
    : { get: api.getTaskDocState, create: api.createTaskDocState, save: api.saveTaskDocState, room: 'task-doc' };
}

/**
 * Общий текст: описание карточки или текст статьи.
 *
 * При открытии: загружаем состояние из task_docs/article_docs, а если его ещё нет —
 * создаём первый снимок из сохранённого HTML. Дальше подключаемся к комнате Supabase
 * и начинаем обмениваться правками и присутствием. Состояние периодически
 * сохраняем, чтобы следующий участник получил не только HTML, но и историю.
 *
 * Если таблица миграции ещё не создана (или база недоступна), возвращаем
 * doc = null: карточка или статья продолжит работать в обычном режиме без
 * совместного редактирования, а не сломается.
 */
export function useCollabDoc({
  id,
  kind = 'task',
  html,
  user,
  enabled,
}: {
  id: string;
  kind?: CollabDocKind;
  html: string | null;
  user: CollabUser | null;
  enabled: boolean;
}): {
  doc: Y.Doc | null;
  provider: SupabaseYjsProvider | null;
  peers: CollabUser[];
  status: CollabStatus;
  error: string | null;
  /** Дождаться сохранения снимка CRDT (перед закрытием карточки или статьи). */
  flush: () => Promise<void>;
} {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<SupabaseYjsProvider | null>(null);
  const [peers, setPeers] = useState<CollabUser[]>([]);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [error, setError] = useState<string | null>(null);

  // исходный HTML нужен только в момент создания документа; дальше им владеет Yjs
  const htmlRef = useRef<string | null>(html);
  htmlRef.current = html;
  const userRef = useRef<CollabUser | null>(user);
  userRef.current = user;
  // сохранение снимка по требованию (перед закрытием карточки или статьи): ссылка на актуальный flush из эффекта
  const flushRef = useRef<() => Promise<void>>(async () => undefined);

  const userId = user?.id ?? null;

  useEffect(() => {
    // пустой текст — тоже нормальный документ: html === null значит «ещё не загрузили карточку или статью»
    if (!enabled || !userId || htmlRef.current === null) return;

    const docApi = docApiFor(kind);
    let alive = true;
    const current = new Y.Doc();
    let currentProvider: SupabaseYjsProvider | null = null;
    let saveTimer: number | undefined;
    let dirty = false;
    let saving: Promise<boolean> | null = null;

    const save = async (): Promise<boolean> => {
      try {
        await docApi.save(id, toBase64(Y.encodeStateAsUpdate(current)));
        if (alive) setError(null);
        return true;
      } catch (e) {
        dirty = true;
        if (alive) setError(`Не удалось сохранить совместный текст: ${humanizeError(e instanceof Error ? e.message : String(e))}`);
        return false;
      }
    };

    const flush = async () => {
      window.clearTimeout(saveTimer);
      if (!alive) return;
      if (saving) await saving;
      // пока шло сохранение, могли прийти новые правки: отправляем и их
      while (alive && dirty) {
        dirty = false;
        saving = save();
        const ok = await saving;
        saving = null;
        if (!ok) break;
      }
    };

    const scheduleSave = () => {
      dirty = true;
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    };

    flushRef.current = flush;
    current.on('update', scheduleSave);

    let peersQueued = false;
    const updatePeers = () => {
      // 'change' у awareness может прилететь во время рендера RichTextEditor
      // (CollaborationCaret выставляет курсор). Состояние обновляем после рендера.
      if (!alive || !currentProvider || peersQueued) return;
      peersQueued = true;
      queueMicrotask(() => {
        peersQueued = false;
        if (alive && currentProvider) setPeers(peersOf(currentProvider.awareness));
      });
    };

    void (async () => {
      try {
        let state = await docApi.get(id);
        if (!state) {
          const seed = toBase64(htmlToYState(htmlRef.current ?? ''));
          state = await docApi.create(id, seed);
        }
        if (!alive) return;

        Y.applyUpdate(current, fromBase64(state));
        // только что загруженное состояние сохранять заново не нужно
        dirty = false;
        window.clearTimeout(saveTimer);

        const channel = supabase.channel(`${docApi.room}:${id}`, {
          config: { broadcast: { self: false } },
        });
        currentProvider = new SupabaseYjsProvider(
          current,
          channel as unknown as ProviderChannel,
          userRef.current as CollabUser,
          (next) => {
            if (alive) setStatus(next);
          },
        );
        currentProvider.awareness.on('change', updatePeers);

        if (!alive) {
          currentProvider.destroy();
          return;
        }
        setDoc(current);
        setProvider(currentProvider);
        updatePeers();
      } catch (e) {
        if (alive) {
          setStatus('offline');
          setError(`Совместное редактирование недоступно: ${humanizeError(e instanceof Error ? e.message : String(e))}`);
        }
      }
    })();

    return () => {
      alive = false;
      window.clearTimeout(saveTimer);
      if (currentProvider) {
        currentProvider.awareness.off('change', updatePeers);
        currentProvider.destroy();
      }
      // последний снимок после закрытия карточки или статьи: не теряем правки, сделанные перед самым закрытием
      if (dirty) {
        void docApi
          .save(id, toBase64(Y.encodeStateAsUpdate(current)))
          .catch(() => undefined);
      }
      current.destroy();
      setDoc(null);
      setProvider(null);
      setPeers([]);
      setStatus('connecting');
    };
  }, [enabled, id, kind, userId]);

  return { doc, provider, peers, status, error, flush: () => flushRef.current() };
}
