import { useRef, useState, useCallback, useEffect } from 'react';

import type { ScrollSegment } from '../types/midi';

interface UseAutoScrollOptions {
  pixelsPerSecond: number; // fallback strategy
  speedMultiplier: number; // dynamically adjusts speed
  totalHeight: number;
  viewportHeight: number;
  scrollSegments?: ScrollSegment[];
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
  { pixelsPerSecond, speedMultiplier, totalHeight, viewportHeight, scrollSegments }: UseAutoScrollOptions
): UseAutoScrollReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const timeAtPlayRef = useRef<number>(0); // Internal logic time when play() started
  const isPlayingRef = useRef(false);

  const maxScroll = Math.max(0, totalHeight - viewportHeight);

  // Time-Pixel helpers
  const timeToPixels = useCallback((t: number) => {
    if (!scrollSegments || scrollSegments.length === 0) return t * pixelsPerSecond;

    for (const seg of scrollSegments) {
      if (t >= seg.startTime && t <= seg.endTime) {
        const segDuration = seg.endTime - seg.startTime;
        const segHeight = seg.endPixel - seg.startPixel;
        const progress = segDuration === 0 ? 0 : (t - seg.startTime) / segDuration;
        return seg.startPixel + (progress * segHeight);
      }
    }
    const last = scrollSegments[scrollSegments.length - 1];
    const lastSpeed = (last.endTime - last.startTime) === 0 ? pixelsPerSecond : (last.endPixel - last.startPixel) / (last.endTime - last.startTime);
    return last.endPixel + (t - last.endTime) * lastSpeed;
  }, [scrollSegments, pixelsPerSecond]);



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

    if (startTimeRef.current === null) {
      startTimeRef.current = timestamp;
    }

    const elapsedWall = (timestamp - startTimeRef.current) / 1000;
    const elapsedGame = elapsedWall * speedMultiplier;
    const currentTime = timeAtPlayRef.current + elapsedGame;

    const targetPxFromBottom = timeToPixels(currentTime);

    // Instead of scrollTop, we use hardware-accelerated translate3d on the Canvas child
    const canvas = scrollRef.current.firstElementChild as HTMLElement;
    if (canvas) {
      // The canvas natively extends `maxScroll` below the viewport.
      // We push it UP by `-maxScroll` to see the bottom, and let it slide DOWN over time.
      canvas.style.transform = `translate3d(0, ${-(maxScroll - targetPxFromBottom)}px, 0)`;
    }

    // Stop at the finish line securely
    if (targetPxFromBottom >= maxScroll) {
      if (canvas) canvas.style.transform = `translate3d(0, 0px, 0)`;
      stop();
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [speedMultiplier, timeToPixels, maxScroll, scrollRef, stop]);

  const play = useCallback(() => {
    if (isPlayingRef.current) return;

    // Instead of reading scrollTop, we derive state precisely from the internal time
    // If the game hasn't started, timeAtPlayRef is 0. 
    // This removes all reliance on DOM measurement lag.
    timeAtPlayRef.current = timeAtPlayRef.current || 0;

    // Transition from native layout scrolling to translate3d scrolling seamlessly
    if (scrollRef.current) {
      // We force native scroll to true top (0) so translate3d drives layout locally
      scrollRef.current.scrollTop = 0;
      const canvas = scrollRef.current.firstElementChild as HTMLElement;
      if (canvas) {
        canvas.style.transform = `translate3d(0, ${-(maxScroll - timeToPixels(timeAtPlayRef.current))}px, 0)`;
      }
    }

    isPlayingRef.current = true;
    setIsPlaying(true);
    startTimeRef.current = null; // anchored on first tick
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const pause = useCallback(() => stop(), [stop]);

  const toggle = useCallback(() => {
    isPlayingRef.current ? pause() : play();
  }, [pause, play]);

  const reset = useCallback(() => {
    stop();
    if (scrollRef.current) {
      const canvas = scrollRef.current.firstElementChild as HTMLElement;
      if (canvas) canvas.style.transform = `none`;
      // Return control to manual DOM scrolling mechanics
      scrollRef.current.scrollTop = maxScroll;
      timeAtPlayRef.current = 0;
    }
  }, [stop, scrollRef, maxScroll]);

  // Reset to bottom on mount
  useEffect(() => {
    if (scrollRef.current) {
      const canvas = scrollRef.current.firstElementChild as HTMLElement;
      if (canvas) canvas.style.transform = `none`;
      scrollRef.current.scrollTop = maxScroll;
      timeAtPlayRef.current = 0;
    }
  }, [scrollRef, maxScroll]);

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop]);

  return { isPlaying, play, pause, toggle, reset };
}
