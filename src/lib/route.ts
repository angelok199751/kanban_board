import { useCallback, useEffect, useState } from 'react';

export type Route =
  | { kind: 'board'; id: string | null }
  | { kind: 'kb'; id: string }
  | { kind: 'archive' }
  | { kind: 'templates' };

const BOARD_HASH = /^#\/board\/([0-9a-f-]{36})$/i;
const KB_HASH = /^#\/kb\/([0-9a-f-]{36})$/i;

function readRoute(): Route {
  const hash = window.location.hash;
  if (hash === '#/archive') return { kind: 'archive' };
  if (hash === '#/templates') return { kind: 'templates' };
  const kb = hash.match(KB_HASH);
  if (kb) return { kind: 'kb', id: kb[1] };
  const m = hash.match(BOARD_HASH);
  return { kind: 'board', id: m ? m[1] : null };
}

/** Раздел и выбранная доска хранятся в адресе (#/board/<id>, #/kb/<id>, #/archive или #/templates): обновление страницы их не теряет. */
export function useRoute() {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const toBoard = useCallback((id: string | null) => {
    window.location.hash = id ? `#/board/${id}` : '#/';
  }, []);
  const toKnowledge = useCallback((id: string) => {
    window.location.hash = `#/kb/${id}`;
  }, []);
  const toArchive = useCallback(() => {
    window.location.hash = '#/archive';
  }, []);
  const toTemplates = useCallback(() => {
    window.location.hash = '#/templates';
  }, []);

  return { route, toBoard, toKnowledge, toArchive, toTemplates };
}
