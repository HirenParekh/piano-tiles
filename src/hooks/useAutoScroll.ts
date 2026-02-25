import { useRef, useState, useCallback, useEffect } from 'react';

interface UseAutoScrollOptions {
  pixelsPerSecond: number;
  totalHeight: number;
  viewportHeight: number;
}

interface UseAutoScrollReturn {
  isPlaying: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  reset: () => void;
}

export function useAutoScroll(
  scrollRef: React.RefObject<HTMLDivElement>,
  { pixelsPerSecond, totalHeight, viewportHeight }: UseAutoScrollOptions
): UseAutoScrollReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const rafRef       = useRef<number | null>(null);
  const lastTimeRef  = useRef<number | null>(null);
  const isPlayingRef = useRef(false);

  const maxScroll = totalHeight - viewportHeight;

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastTimeRef.current = null;
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  const tick = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return;
    if (!scrollRef.current) return;

    if (lastTimeRef.current === null) {
      lastTimeRef.current = timestamp;
    }

    const delta = (timestamp - lastTimeRef.current) / 1000;
    lastTimeRef.current = timestamp;

    const current = scrollRef.current.scrollTop;
    const next = current - pixelsPerSecond * delta; // ← decrement, scroll upward

    if (next <= 0) {
      scrollRef.current.scrollTop = 0;
      stop();
      return;
    }

    scrollRef.current.scrollTop = next;
    rafRef.current = requestAnimationFrame(tick);
  }, [pixelsPerSecond, scrollRef, stop]);

  const play = useCallback(() => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;
    setIsPlaying(true);
    lastTimeRef.current = null;
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const pause = useCallback(() => stop(), [stop]);

  const toggle = useCallback(() => {
    isPlayingRef.current ? pause() : play();
  }, [pause, play]);

  const reset = useCallback(() => {
    stop();
    if (scrollRef.current) {
      scrollRef.current.scrollTop = maxScroll; // ← reset to bottom
    }
  }, [stop, scrollRef, maxScroll]);

  // Jump to bottom on mount so the song starts correctly
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = maxScroll;
    }
  }, [scrollRef, maxScroll]);

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop]);

  return { isPlaying, play, pause, toggle, reset };
}