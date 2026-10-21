import { useCallback, useEffect, useState } from 'react';

const BOARD_HASH = /^#\/board\/([0-9a-f-]{36})$/i;

function readBoardId(): string | null {
  const m = window.location.hash.match(BOARD_HASH);
  return m ? m[1] : null;
}

/** Выбранная доска хранится в адресе (#/board/<id>): обновление страницы её не теряет. */
export function useBoardRoute(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(readBoardId);

  useEffect(() => {
    const onChange = () => setId(readBoardId());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const go = useCallback((next: string | null) => {
    window.location.hash = next ? `#/board/${next}` : '#/';
  }, []);

  return [id, go];
}
