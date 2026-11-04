// Протокол совместного описания без сети: два Yjs-документа общаются через
// такой же Broadcast-канал, как в Supabase, только в памяти.
import * as Y from 'yjs';
import {
  peersOf,
  SupabaseYjsProvider,
  type CollabUser,
  type ProviderChannel,
} from '../../../src/features/collab/provider';

const eq = (a: unknown, b: unknown, m: string) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`); };
const ok = (value: unknown, m: string) => { if (!value) throw new Error(`FAIL ${m}`); };

const userA: CollabUser = { id: 'u-a', name: 'Анна', color: '#2563eb' };
const userB: CollabUser = { id: 'u-b', name: 'Борис', color: '#16a34a' };

type Listener = { event: string; cb: (message: { payload: unknown }) => void };

/** Канал в памяти: broadcast получают все подписчики той же комнаты, кроме отправителя. */
function createBus() {
  const rooms = new Map<string, Set<TestChannel>>();
  class TestChannel implements ProviderChannel {
    private readonly listeners: Listener[] = [];
    constructor(private readonly room: string) {}
    on(_type: 'broadcast', filter: { event: string }, cb: (message: { payload: unknown }) => void) {
      this.listeners.push({ event: filter.event, cb });
      return this;
    }
    subscribe(callback?: (status: string) => void) {
      const room = rooms.get(this.room) ?? new Set<TestChannel>();
      room.add(this);
      rooms.set(this.room, room);
      callback?.('SUBSCRIBED');
      return this;
    }
    send(message: { type: 'broadcast'; event: string; payload: unknown }) {
      for (const peer of rooms.get(this.room) ?? []) {
        if (peer === this) continue;
        for (const listener of peer.listeners) {
          if (listener.event === message.event) listener.cb({ payload: message.payload });
        }
      }
      return Promise.resolve('ok');
    }
    unsubscribe() {
      rooms.get(this.room)?.delete(this);
      return this;
    }
  }
  return (room: string): ProviderChannel => new TestChannel(room);
}

// 1. Поздний участник получает уже набранный текст, затем правки идут в обе стороны.
{
  const connect = createBus();
  const docA = new Y.Doc();
  docA.getText('notes').insert(0, 'первая строка');

  const providerA = new SupabaseYjsProvider(docA, connect('card-1'), userA, () => undefined);
  const docB = new Y.Doc();
  const providerB = new SupabaseYjsProvider(docB, connect('card-1'), userB, () => undefined);

  eq(docB.getText('notes').toString(), 'первая строка', 'поздний участник получил историю');

  docA.getText('notes').insert(docA.getText('notes').length, ' + А');
  eq(docB.getText('notes').toString(), 'первая строка + А', 'правка А дошла до Б');

  docB.getText('notes').insert(0, 'Б: ');
  eq(docA.getText('notes').toString(), 'Б: первая строка + А', 'правка Б дошла до А');
  eq(docB.getText('notes').toString(), 'Б: первая строка + А', 'документы сошлись');

  // 2. Присутствие: каждый видит другого в том же описании.
  const seenByB = peersOf(providerB.awareness);
  const seenByA = peersOf(providerA.awareness);
  ok(seenByB.some((p) => p.id === userA.id), 'Б видит Анну');
  ok(seenByA.some((p) => p.id === userB.id), 'А видит Бориса');
  eq(seenByB.find((p) => p.id === userA.id)?.color, userA.color, 'цвет участника');

  providerA.destroy();
  providerB.destroy();
  docA.destroy();
  docB.destroy();
}

// 3. Одновременные правки не теряются: оба текста остаются.
{
  const connect = createBus();
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const providerA = new SupabaseYjsProvider(docA, connect('card-2'), userA, () => undefined);
  const providerB = new SupabaseYjsProvider(docB, connect('card-2'), userB, () => undefined);

  docA.getText('notes').insert(0, 'слева');
  docB.getText('notes').insert(0, 'справа');

  const textA = docA.getText('notes').toString();
  const textB = docB.getText('notes').toString();
  eq(textA, textB, 'одновременные правки сошлись');
  ok(textA.includes('слева') && textA.includes('справа'), 'обе правки сохранились: ' + textA);

  providerA.destroy();
  providerB.destroy();
  docA.destroy();
  docB.destroy();
}

console.log('collab tests ok');
