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

  const pixelsToTime = useCallback((px: number) => {
    if (!scrollSegments || scrollSegments.length === 0) return px / pixelsPerSecond;

    // Below the first segment (e.g., negative pixels or start padding)
    const first = scrollSegments[0];
    if (px < first.startPixel) {
      const firstSpeed = (first.endTime - first.startTime) === 0 ? pixelsPerSecond : (first.endPixel - first.startPixel) / (first.endTime - first.startTime);
      return first.startTime - (first.startPixel - px) / firstSpeed;
    }

    // Inside a valid segment
    for (const seg of scrollSegments) {
      if (px >= seg.startPixel && px <= seg.endPixel) {
        const segDuration = seg.endTime - seg.startTime;
        const segHeight = seg.endPixel - seg.startPixel;
        const progress = segHeight === 0 ? 0 : (px - seg.startPixel) / segHeight;
        return seg.startTime + (progress * segDuration);
      }
    }

    // Above the last segment
    const last = scrollSegments[scrollSegments.length - 1];
    const lastSpeed = (last.endTime - last.startTime) === 0 ? pixelsPerSecond : (last.endPixel - last.startPixel) / (last.endTime - last.startTime);
    return last.endTime + (px - last.endPixel) / lastSpeed;
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
    const nextScrollTop = maxScroll - targetPxFromBottom;

    if (nextScrollTop <= 0) {
      scrollRef.current.scrollTop = 0;
      stop();
      return;
    }

    scrollRef.current.scrollTop = nextScrollTop;
    rafRef.current = requestAnimationFrame(tick);
  }, [speedMultiplier, timeToPixels, maxScroll, scrollRef, stop]);

  const play = useCallback(() => {
    if (isPlayingRef.current) return;
    const currentScrollTop = scrollRef.current?.scrollTop ?? maxScroll;
    const currentPxFromBottom = maxScroll - currentScrollTop;

    // If we are at the very start (with 1px float precision tolerance), force time 0 
    // to prevent the pixelsToTime scale offset from jumping ahead.
    if (Math.abs(currentPxFromBottom) <= 1) {
      timeAtPlayRef.current = 0;
    } else {
      timeAtPlayRef.current = pixelsToTime(currentPxFromBottom);
    }

    isPlayingRef.current = true;
    setIsPlaying(true);
    startTimeRef.current = null; // anchored on first tick
    rafRef.current = requestAnimationFrame(tick);
  }, [tick, scrollRef, maxScroll, pixelsToTime]);

  const pause = useCallback(() => stop(), [stop]);

  const toggle = useCallback(() => {
    isPlayingRef.current ? pause() : play();
  }, [pause, play]);

  const reset = useCallback(() => {
    stop();
    if (scrollRef.current) {
      scrollRef.current.scrollTop = maxScroll;
      timeAtPlayRef.current = 0;
    }
  }, [stop, scrollRef, maxScroll]);

  // Jump to bottom on mount so the song starts correctly
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = maxScroll;
      timeAtPlayRef.current = 0;
    }
  }, [scrollRef, maxScroll]);

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop]);

  return { isPlaying, play, pause, toggle, reset };
}
