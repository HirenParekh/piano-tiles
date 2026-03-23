import { useRef, useCallback } from 'react';
import type { Tile } from '../../types/track';

interface UseGameBoardReturn {
  tapTile: (tile: Tile) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  /** Attach to the score display element — textContent is updated directly, no React state. */
  scoreElRef: React.RefObject<HTMLElement>;
  reset: () => void;
}

export function useGameBoard(
  onPlayNote: (tile: Tile) => void
): UseGameBoardReturn {
  const tappedIdsRef = useRef<Set<string>>(new Set());
  const scoreCountRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scoreElRef = useRef<HTMLElement>(null);

  const tapTile = useCallback((tile: Tile) => {
    if (tappedIdsRef.current.has(tile.id)) return;
    tappedIdsRef.current.add(tile.id);
    // Direct DOM updates — bypasses React re-render pipeline entirely.
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-tile-id="${tile.id}"]`)
      ?.classList.add('game-tile--tapped');
    scoreCountRef.current += 1;
    if (scoreElRef.current) scoreElRef.current.textContent = String(scoreCountRef.current);
    onPlayNote(tile);
  }, [onPlayNote]);

  const reset = useCallback(() => {
    tappedIdsRef.current.clear();
    scoreCountRef.current = 0;
    if (scoreElRef.current) scoreElRef.current.textContent = '0';
    scrollRef.current
      ?.querySelectorAll<HTMLElement>('.game-tile--tapped')
      .forEach(el => el.classList.remove('game-tile--tapped'));
  }, []);

  return { tapTile, scrollRef, scoreElRef, reset };
}