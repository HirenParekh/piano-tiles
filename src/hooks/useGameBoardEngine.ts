/**
 * useGameBoardEngine — the single source of truth for all game logic.
 *
 * WHY this hook exists:
 *   GameBoard.tsx used to mix game logic (timing, scroll, scaling) with UI rendering.
 *   Extracting all logic here means we can swap the visual "skin" freely without
 *   ever touching the mechanics. Both GameBoardClassicSkin and GameBoardDebugSkin
 *   consume this hook and get identical game behaviour.
 *
 * WHAT it owns:
 *   - Converting the song's MidiParseResult into a render-ready GameTrackData
 *   - Measuring the DOM viewport height so we can derive the pixel scale ratio
 *   - Computing scaledTotalHeight (total canvas height in CSS pixels)
 *   - Beat-line positions (used by the debug skin)
 *   - Wiring useAutoScroll so the board scrolls at the correct musical tempo
 *   - Tracking which tiles have been tapped (delegated to useGameBoard)
 *
 * WHAT it does NOT own:
 *   - Any JSX / visual output — that belongs to the skin components
 *   - Audio — that is handled upstream in App.tsx via useTileAudio
 */

import { useCallback, useState, useEffect, useMemo } from 'react';
import type { MidiParseResult } from '../types/midi';
import type { Tile } from '../types/track';
import { useGameBoard } from './useGameBoard';
import { useAutoScroll } from './useAutoScroll';
import { MIN_HEIGHT } from '../utils/tileBuilder';
import { buildTrackFromTiles } from '../utils/trackBuilder';

interface Props {
  result: MidiParseResult;
  /** Called when the player taps any tile. Caller (App.tsx) handles audio. */
  onPlayNote: (tile: Tile) => void;
  /** Playback speed multiplier (e.g. 0.5 = half speed). Defaults to 1. */
  speedMultiplier?: number;
}

export function useGameBoardEngine({ result, onPlayNote, speedMultiplier = 1 }: Props) {
  // ── Tap state & scroll ref ──────────────────────────────────────────────
  // useGameBoard owns: the Set of tapped tile IDs (for visual feedback) and
  // the ref attached to the scrollable viewport div (needed by useAutoScroll).
  const { tappedIds, tapTile, scrollRef } = useGameBoard(onPlayNote);

  // Whether the player has tapped START — gates auto-scroll and touch-action
  const [started, setStarted] = useState(false);

  // Physical height of the scrollable viewport in CSS pixels.
  // Measured via ResizeObserver so it updates on window resize.
  const [viewportH, setViewportH] = useState(0);

  // ── Track data ──────────────────────────────────────────────────────────
  // buildTrackFromTiles converts the flat GameTile[] (from the parser pipeline)
  // into a Card[] that the CSS grid renderer can iterate directly.
  // Memoised on `tiles` identity — only re-runs when the song changes.
  const { tiles, info } = result;
  const trackData = useMemo(() => buildTrackFromTiles(tiles), [tiles]);

  // ── Viewport measurement ────────────────────────────────────────────────
  // We can't use CSS vh because the board may be inset inside another container.
  // ResizeObserver gives us the true content height of the scroll viewport.
  useEffect(() => {
    if (!scrollRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const en of entries) setViewportH(en.contentRect.height);
    });
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [scrollRef]);

  // ── Scale ratio ─────────────────────────────────────────────────────────
  // The board is designed so exactly 4 slots fit in the visible viewport.
  // scaleRatio = (viewportH / 4 slots) / MIN_HEIGHT(px per slot at 1:1)
  // Every pixel measurement derived from slot positions is multiplied by this.
  const scaleRatio = (viewportH / 4) / MIN_HEIGHT;

  useEffect(() => {
    document.documentElement.style.setProperty('--tile-unit', `${MIN_HEIGHT * scaleRatio}px`);
  }, [scaleRatio]);

  // Total canvas height in CSS pixels — the full scrollable content height
  const scaledTotalHeight = trackData.totalRows * MIN_HEIGHT * scaleRatio;

  // ── Timing ──────────────────────────────────────────────────────────────
  // effectiveBpm may differ from the raw bpm when baseBeats != 1
  // (e.g. baseBeats=0.5 doubles the effective tempo).
  // slotDurationS = how many real seconds one slot lasts.
  const effectiveBpm = info.effectiveBpm ?? info.bpm;
  const slotDurationS = 60 / effectiveBpm;

  // ── Beat lines (debug use) ──────────────────────────────────────────────
  // One horizontal line per slot row, positioned in CSS pixels from the top
  // of the canvas. The debug skin renders these; the classic skin ignores them.
  const beatLines = useMemo(() => {
    const lines: { y: number; beat: number; timeS: number }[] = [];
    for (let i = 1; i < trackData.totalRows; i++) {
      lines.push({
        // Canvas is column-reverse (bottom = beat 0), so y counts down from top
        y: scaledTotalHeight - i * MIN_HEIGHT * scaleRatio,
        beat: i,
        timeS: i * slotDurationS,
      });
    }
    return lines;
  }, [trackData.totalRows, scaledTotalHeight, scaleRatio, slotDurationS]);

  // ── Scroll segments ─────────────────────────────────────────────────────
  // Some songs define variable-speed scroll sections (e.g. a pause then fast run).
  // We scale the pre-computed pixel boundaries from the parser to match scaleRatio.
  const scaledScrollSegments = useMemo(
    () => info.scrollSegments?.map(s => ({
      ...s,
      startPixel: s.startPixel * scaleRatio,
      endPixel: s.endPixel * scaleRatio,
    })),
    [info.scrollSegments, scaleRatio],
  );

  // ── Auto-scroll ─────────────────────────────────────────────────────────
  // Pixels per second = (one slot in px) / (one slot in seconds)
  // play() is called when the player taps START; it kicks off the rAF loop.
  const { play } = useAutoScroll(scrollRef, {
    pixelsPerSecond: (MIN_HEIGHT / slotDurationS) * scaleRatio,
    speedMultiplier,
    totalHeight: scaledTotalHeight,
    viewportHeight: viewportH,
    scrollSegments: scaledScrollSegments,
  });

  // ── Start handler ───────────────────────────────────────────────────────
  // Wrapped in useCallback so the skin's onPointerDown handler doesn't get
  // a new function reference on every render (prevents unnecessary re-renders).
  const handleStart = useCallback(() => {
    setStarted(true);
    play();
  }, [play]);

  // ── Exposed API ─────────────────────────────────────────────────────────
  // Everything a skin needs to render and interact with the game.
  return {
    trackData,       // Card[] for TileLayer rendering
    scaleRatio,      // Multiply slot-px values by this to get CSS px
    scaledTotalHeight, // CSS height of the full canvas div
    beatLines,       // Debug-only: horizontal grid lines with beat/time labels
    started,         // Has the player tapped START?
    handleStart,     // Call on START tile pointer-down
    scrollRef,       // Attach to the scrollable viewport div
    tappedIds,       // Set<tileId> — controls tapped visual state on tiles
    tapTile,         // Call when a tile is tapped
    viewportH,       // CSS height of the visible scroll window
    slotDurationS,   // Seconds per slot (for reference; audio timing is upstream)
    info,            // Song metadata (name, bpm, etc.)
  };
}

/** Convenience type so skins can type their `engine` prop without re-importing the hook. */
export type GameBoardEngine = ReturnType<typeof useGameBoardEngine>;
