import { useState, useCallback, useRef } from 'react';
import type { GameTile } from '../types/midi';

interface UseGameBoardReturn {
  tappedIds: Set<string>;
  tapTile: (tile: GameTile) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  reset: () => void;
}

export function useGameBoard(
  onPlayNote: (tile: GameTile) => void
): UseGameBoardReturn {
  const [tappedIds, setTappedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const tapTile = useCallback((tile: GameTile) => {
    if (tappedIds.has(tile.id)) return;
    onPlayNote(tile);
    setTappedIds(prev => new Set(prev).add(tile.id));
  }, [tappedIds, onPlayNote]);

  const reset = useCallback(() => {
    setTappedIds(new Set());
    // scrollTop reset is handled by useAutoScroll
  }, []);

  return { tappedIds, tapTile, scrollRef, reset };
}