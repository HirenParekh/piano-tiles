import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';

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

/**
 * Pre-compute WAAPI keyframes from scroll segments (or a simple two-stop linear
 * when no segments are present). Each segment boundary becomes a keyframe with
 * an explicit `offset` (normalised 0–1 time) so that linear easing between stops
 * exactly reproduces the variable-speed behaviour of the old timeToPixels helper.
 */
function buildKeyframes(
  scrollSegments: ScrollSegment[] | undefined,
  maxScroll: number,
  pixelsPerSecond: number,
  totalHeight: number,
): { keyframes: Keyframe[]; durationMs: number } {
  if (!scrollSegments || scrollSegments.length === 0) {
    return {
      keyframes: [
        { transform: `translateY(${-maxScroll}px)`, easing: 'linear' },
        { transform: 'translateY(0px)' },
      ],
      durationMs: (totalHeight / pixelsPerSecond) * 1000,
    };
  }

  const totalDurationS = scrollSegments[scrollSegments.length - 1].endTime;
  const keyframes: Keyframe[] = [
    { offset: 0, transform: `translateY(${-maxScroll}px)`, easing: 'linear' },
  ];
  for (let i = 0; i < scrollSegments.length; i++) {
    const seg = scrollSegments[i];
    const isLast = i === scrollSegments.length - 1;
    keyframes.push({
      offset: isLast ? 1 : seg.endTime / totalDurationS,
      transform: `translateY(${-(maxScroll - seg.endPixel)}px)`,
      // No easing on final keyframe
      ...(isLast ? {} : { easing: 'linear' }),
    });
  }

  return { keyframes, durationMs: totalDurationS * 1000 };
}

export function useAutoScroll(
  scrollRef: React.RefObject<HTMLDivElement>,
  { pixelsPerSecond, speedMultiplier, totalHeight, viewportHeight, scrollSegments }: UseAutoScrollOptions
): UseAutoScrollReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const animRef = useRef<Animation | null>(null);
  const isPlayingRef = useRef(false);
  const speedMultiplierRef = useRef(speedMultiplier);
  // Keep ref always current so play() reads the right rate when creating the animation
  speedMultiplierRef.current = speedMultiplier;

  const maxScroll = Math.max(0, totalHeight - viewportHeight);

  // Push speed changes to a live animation (e.g. user drags the speed slider)
  useEffect(() => {
    if (animRef.current) animRef.current.playbackRate = speedMultiplier;
  }, [speedMultiplier]);

  const stop = useCallback(() => {
    animRef.current?.pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (isPlayingRef.current || !scrollRef.current) return;
    const canvas = scrollRef.current.firstElementChild as HTMLElement;
    if (!canvas) return;

    // Hand off from native-scroll preview mode to WAAPI-driven scroll
    scrollRef.current.scrollTop = 0;

    if (!animRef.current) {
      // Create the WAAPI animation once — subsequent play() calls just resume it
      const { keyframes, durationMs } = buildKeyframes(scrollSegments, maxScroll, pixelsPerSecond, totalHeight);
      const anim = canvas.animate(keyframes, { duration: durationMs, fill: 'forwards' });
      anim.playbackRate = speedMultiplierRef.current;
      anim.pause(); // start paused; the play() call below will start it
      anim.addEventListener('finish', () => {
        isPlayingRef.current = false;
        setIsPlaying(false);
      });
      animRef.current = anim;
    }

    animRef.current.play();
    isPlayingRef.current = true;
    setIsPlaying(true);
  }, [scrollRef, scrollSegments, maxScroll, pixelsPerSecond, totalHeight]);

  const pause = useCallback(() => stop(), [stop]);

  const toggle = useCallback(() => {
    isPlayingRef.current ? pause() : play();
  }, [pause, play]);

  const reset = useCallback(() => {
    animRef.current?.cancel();
    animRef.current = null;
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (scrollRef.current) {
      const canvas = scrollRef.current.firstElementChild as HTMLElement;
      if (canvas) canvas.style.transform = 'none';
      // Return control to native-scroll preview mode
      scrollRef.current.scrollTop = maxScroll;
    }
  }, [scrollRef, maxScroll]);

  // Set initial scroll position for the native-scroll preview mode (before play)
  useLayoutEffect(() => {
    if (scrollRef.current) {
      const canvas = scrollRef.current.firstElementChild as HTMLElement;
      if (canvas) canvas.style.transform = 'none';
      scrollRef.current.scrollTop = maxScroll;
    }
  }, [scrollRef, maxScroll]);

  // Cleanup on unmount
  useEffect(() => () => { animRef.current?.cancel(); }, []);

  return { isPlaying, play, pause, toggle, reset };
}
