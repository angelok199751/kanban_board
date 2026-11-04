import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { fromBase64, toBase64 } from '../../lib/base64';

export interface CollabUser {
  id: string;
  name: string;
  color: string;
}

export type CollabStatus = 'connecting' | 'online' | 'offline';

/**
 * Минимальный канал Supabase Realtime, который нужен провайдеру.
 * Отдельный интерфейс позволяет проверять протокол без настоящей сети.
 */
export interface ProviderChannel {
  on(
    type: 'broadcast',
    filter: { event: string },
    callback: (message: { payload: unknown }) => void,
  ): unknown;
  subscribe(callback?: (status: string) => void): unknown;
  send(message: { type: 'broadcast'; event: string; payload: unknown }): unknown;
  unsubscribe(): unknown;
}

const EVENT = 'y-doc';
const HEARTBEAT_MS = 15000;
const PEER_TIMEOUT_MS = 45000;

type Message =
  | { t: 'sync1'; from: string; sv?: string }
  | { t: 'sync2'; from: string; to?: string; sv: string; update?: string }
  | { t: 'sync3'; from: string; to?: string; update: string }
  | { t: 'update'; from: string; update: string }
  | { t: 'aware'; from: string; update: string };

/**
 * Обмен правками Yjs через Supabase Realtime Broadcast.
 *
 * Протокол повторяет обычный y-websocket, только без сервера:
 *  - при подключении каждый отправляет свой «вектор состояния» (sync1);
 *  - остальные отвечают недостающими правками (sync2);
 *  - получивший отвечает тем же (sync3) — так оба догоняют друг друга;
 *  - дальше каждая правка сразу рассылается событием update.
 *
 * Плюс Awareness: кто сейчас в карточке, где курсор и что выделено.
 * Все сообщения идемпотентны: повторное применение правки ничего не ломает.
 */
export class SupabaseYjsProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly id: string;

  private readonly channel: ProviderChannel;
  private readonly onStatus: (status: CollabStatus) => void;
  private readonly seen = new Map<number, number>();
  private ready = false;
  private destroyed = false;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;

  constructor(
    doc: Y.Doc,
    channel: ProviderChannel,
    user: CollabUser,
    onStatus: (status: CollabStatus) => void,
  ) {
    this.doc = doc;
    this.channel = channel;
    this.id = String(doc.clientID);
    this.onStatus = onStatus;
    this.awareness = new Awareness(doc);
    this.awareness.setLocalStateField('user', { id: user.id, name: user.name, color: user.color });

    doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    channel.on('broadcast', { event: EVENT }, this.onMessage);
    channel.subscribe(this.onSubscribe);

    this.heartbeat = setInterval(() => {
      this.sendAwareness([this.doc.clientID]);
      this.checkStalePeers();
    }, HEARTBEAT_MS);
    this.watchdog = setInterval(() => this.checkStalePeers(), 5000);
  }

  /** Отключает провайдера: снимает подписку и убирает свой курсор у остальных. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    clearInterval(this.heartbeat);
    clearInterval(this.watchdog);
    this.awareness.setLocalState(null);
    this.channel.unsubscribe();
    this.awareness.destroy();
  }

  // ------------------------------------------------------------------ отправка
  private send(message: Message) {
    if (!this.ready || this.destroyed) return;
    try {
      const result = this.channel.send({ type: 'broadcast', event: EVENT, payload: message });
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        void (result as Promise<unknown>).catch(() => this.onStatus('offline'));
      }
    } catch {
      this.onStatus('offline');
    }
  }

  private sendAwareness(clients: number[]) {
    if (clients.length === 0) return;
    this.send({ t: 'aware', from: this.id, update: toBase64(encodeAwarenessUpdate(this.awareness, clients)) });
  }

  private onSubscribe = (status: string) => {
    if (this.destroyed) return;
    if (status === 'SUBSCRIBED') {
      this.ready = true;
      this.onStatus('online');
      // свой полный вектор: остальные пришлют то, чего у нас нет
      this.send({ t: 'sync1', from: this.id, sv: toBase64(Y.encodeStateVector(this.doc)) });
      this.sendAwareness([this.doc.clientID]);
      return;
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      this.ready = false;
      this.onStatus(status === 'CLOSED' ? 'offline' : 'connecting');
    }
  };

  // ------------------------------------------------------------------ правки документа
  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // правка пришла от другого участника через этот же провайдер: обратно не отправляем
    if (origin === this) return;
    this.send({ t: 'update', from: this.id, update: toBase64(update) });
  };

  private onMessage = (message: { payload: unknown }) => {
    const msg = message.payload as Message | undefined;
    if (!msg || typeof msg !== 'object' || !msg.t || msg.from === this.id) return;
    if ('to' in msg && msg.to && msg.to !== this.id) return; // адресовано другому участнику

    try {
      switch (msg.t) {
        case 'sync1': {
          const update = Y.encodeStateAsUpdate(this.doc, msg.sv ? fromBase64(msg.sv) : undefined);
          this.send({
            t: 'sync2',
            from: this.id,
            to: msg.from,
            sv: toBase64(Y.encodeStateVector(this.doc)),
            update: toBase64(update),
          });
          break;
        }
        case 'sync2': {
          this.applyUpdate(msg.update ?? '');
          // отдаём собеседнику то, чего нет у него
          const reply = Y.encodeStateAsUpdate(this.doc, fromBase64(msg.sv));
          if (reply.length > 2) this.send({ t: 'sync3', from: this.id, to: msg.from, update: toBase64(reply) });
          break;
        }
        case 'sync3':
        case 'update': {
          this.applyUpdate(msg.update);
          break;
        }
        case 'aware': {
          applyAwarenessUpdate(this.awareness, fromBase64(msg.update), this);
          const peer = Number(msg.from);
          const known = this.seen.has(peer);
          this.seen.set(peer, Date.now());
          // новому участнику сразу показываем себя, не дожидаясь пульса
          if (!known) this.sendAwareness([this.doc.clientID]);
          break;
        }
      }
    } catch {
      // битое или несовместимое сообщение: соединение не роняем, ждём следующего
    }
  };

  private applyUpdate(encoded: string) {
    if (!encoded) return;
    Y.applyUpdate(this.doc, fromBase64(encoded), this);
  }

  // ------------------------------------------------------------------ присутствие
  private onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return;
    const clients = [...changes.added, ...changes.updated, ...changes.removed];
    if (clients.length === 0) return;
    this.sendAwareness(clients);
    for (const client of clients) {
      if (client === this.doc.clientID) continue;
      if (changes.removed.includes(client)) this.seen.delete(client);
      else this.seen.set(client, Date.now());
    }
  };

  /** Убирает курсоры тех, кто давно не подавал признаков жизни (закрыл вкладку без прощания). */
  private checkStalePeers() {
    const now = Date.now();
    const stale: number[] = [];
    for (const [client, at] of this.seen) {
      if (now - at > PEER_TIMEOUT_MS) stale.push(client);
    }
    if (stale.length === 0) return;
    for (const client of stale) this.seen.delete(client);
    removeAwarenessStates(this.awareness, stale, this);
  }
}

/** Список участников, которые сейчас находятся в этом же описании (без себя). */
export function peersOf(awareness: Awareness): CollabUser[] {
  const peers: CollabUser[] = [];
  awareness.getStates().forEach((state, client) => {
    if (client === awareness.clientID) return;
    const user = state.user as Partial<CollabUser> | undefined;
    if (!user?.id || !user.name) return;
    peers.push({ id: user.id, name: user.name, color: user.color ?? '#888' });
  });
  return peers.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
