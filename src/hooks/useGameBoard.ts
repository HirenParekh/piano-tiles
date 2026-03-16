import { useState, useCallback, useRef } from 'react';
import type { Tile } from '../types/track';

interface UseGameBoardReturn {
  tappedIds: Set<string>;
  tapTile: (tile: Tile) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  reset: () => void;
}

export function useGameBoard(
  onPlayNote: (tile: Tile) => void
): UseGameBoardReturn {
  // Ref mirrors the Set for synchronous dedup checks inside tapTile without
  // creating a closure dependency on state — keeps tapTile identity stable.
  const tappedIdsRef = useRef<Set<string>>(new Set());
  const [tappedIds, setTappedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const tapTile = useCallback((tile: Tile) => {
    if (tappedIdsRef.current.has(tile.id)) return;
    onPlayNote(tile);
    tappedIdsRef.current = new Set(tappedIdsRef.current).add(tile.id);
    setTappedIds(tappedIdsRef.current);
  }, [onPlayNote]); // tappedIds removed from deps — ref handles dedup

  const reset = useCallback(() => {
    tappedIdsRef.current = new Set();
    setTappedIds(new Set());
    // scrollTop reset is handled by useAutoScroll
  }, []);

  return { tappedIds, tapTile, scrollRef, reset };
}