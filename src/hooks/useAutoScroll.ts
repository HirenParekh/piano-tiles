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
  const rafRef        = useRef<number | null>(null);
  const startTimeRef  = useRef<number | null>(null); // anchored to first rAF timestamp
  const startScrollRef = useRef<number>(0);          // scrollTop when play() was called
  const isPlayingRef  = useRef(false);

  const maxScroll = totalHeight - viewportHeight;

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    startTimeRef.current = null;
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  const tick = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return;
    if (!scrollRef.current) return;

    // Anchor start time to the first frame so elapsed is always exact
    if (startTimeRef.current === null) {
      startTimeRef.current = timestamp;
    }

    const elapsed = (timestamp - startTimeRef.current) / 1000;
    // Absolute position: no accumulation, no drift
    const next = startScrollRef.current - elapsed * pixelsPerSecond;

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
    startScrollRef.current = scrollRef.current?.scrollTop ?? maxScroll;
    isPlayingRef.current = true;
    setIsPlaying(true);
    startTimeRef.current = null; // anchored on first tick
    rafRef.current = requestAnimationFrame(tick);
  }, [tick, scrollRef, maxScroll]);

  const pause = useCallback(() => stop(), [stop]);

  const toggle = useCallback(() => {
    isPlayingRef.current ? pause() : play();
  }, [pause, play]);

  const reset = useCallback(() => {
    stop();
    if (scrollRef.current) {
      scrollRef.current.scrollTop = maxScroll;
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
