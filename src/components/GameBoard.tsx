import { useCallback, useState } from 'react';
import type { GameTile, MidiParseResult } from '../types/midi';
import { GameTileCard } from './GameTileCard';
import { HoldTileCard } from './HoldTileCard';
import { useGameBoard } from '../hooks/useGameBoard';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { MIN_HEIGHT } from '../utils/midiParser';

const SPEED_OPTIONS = [1, 1.5, 2] as const;

interface Props {
  result: MidiParseResult;
  onPlayNote: (tile: GameTile) => void;
  onHoldRelease?: () => void;
  onSpeedChange?: (multiplier: number) => void;
}

const LANE_COUNT = 4;
const VIEWPORT_H = 600; // approximation — matches CSS height

function groupByLane(tiles: GameTile[]): Map<number, GameTile[]> {
  const map = new Map<number, GameTile[]>();
  for (let i = 0; i < LANE_COUNT; i++) map.set(i, []);
  for (const tile of tiles) map.get(tile.lane)?.push(tile);
  return map;
}

export function GameBoard({ result, onPlayNote, onHoldRelease, onSpeedChange }: Props) {
  const { tappedIds, tapTile, scrollRef, reset: resetBoard } = useGameBoard(onPlayNote);
  const [started, setStarted] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState<typeof SPEED_OPTIONS[number]>(1);

  const { tiles, info, totalHeight } = result;
  const byLane = groupByLane(tiles);

  // Use effectiveBpm for scroll speed: TPS = effectiveBpm / 60, px/s = TPS × MIN_HEIGHT.
  // For PianoTiles JSON songs effectiveBpm = bpm / baseBeats (e.g. 90 BPM + 0.5 baseBeats → 180).
  // For MIDI files effectiveBpm is undefined so we fall back to bpm.
  const effectiveBpm  = info.effectiveBpm ?? info.bpm;
  const slotDurationS = 60 / effectiveBpm;        // seconds per tile slot
  const PX_PER_SEC    = (MIN_HEIGHT / slotDurationS) * speedMultiplier;

  // Grid lines — one line every MIN_HEIGHT px (= 1 tile slot)
  const beatLines: { y: number; beat: number; timeS: number }[] = [];
  for (let y = totalHeight - MIN_HEIGHT, beat = 1; y >= 0; y -= MIN_HEIGHT, beat++) {
    beatLines.push({ y, beat, timeS: beat * slotDurationS });
  }

  const { isPlaying, play, reset: resetScroll } = useAutoScroll(scrollRef, {
    pixelsPerSecond: PX_PER_SEC,
    totalHeight,
    viewportHeight: VIEWPORT_H,
  });

  const handleReset = () => {
    resetScroll();
    resetBoard();
    setStarted(false);
  };

  const handleSpeedChange = (mult: typeof SPEED_OPTIONS[number]) => {
    setSpeedMultiplier(mult);
    onSpeedChange?.(mult);
    resetScroll();
    resetBoard();
    setStarted(false);
  };

  // START tile handler — only triggers scroll, no note played
  const handleStart = useCallback(() => {
    setStarted(true);
    play();
  }, [play]);

  // Regular tile tap — only plays the note, scroll already running
  const handleTileTap = useCallback((tile: GameTile) => {
    tapTile(tile);
  }, [tapTile]);

  // START tile sits at beat 0 — below all real notes, visible on mount
  const startTileTop = totalHeight - MIN_HEIGHT;

  return (
    <div className="game-board">

      {/* Top bar */}
      <div className="game-board__topbar">
        <span className="game-board__song">{info.name}</span>
        <span className="game-board__score">
          {tappedIds.size}<span>/{tiles.length}</span>
        </span>
        <div className="game-board__controls">
          {SPEED_OPTIONS.map(s => (
            <button
              key={s}
              className={`btn-ghost btn-ghost--xs${speedMultiplier === s ? ' btn-ghost--active' : ''}`}
              onClick={() => handleSpeedChange(s)}
            >
              {s}x
            </button>
          ))}
          <button className="btn-ghost btn-ghost--xs" onClick={handleReset} title="Restart">
            ↺
          </button>
        </div>
      </div>

      {/* Viewport */}
      <div className="game-board__viewport" ref={scrollRef} onContextMenu={(e) => e.preventDefault()}>
        <div className="game-board__canvas" style={{ height: totalHeight }}>

          {/* ── Grid layer (background) ── */}
          <div className="game-board__grid-layer">
            {/* Lane column separators */}
            <div className="game-board__lanes">
              {Array.from({ length: LANE_COUNT }).map((_, i) => (
                <div key={i} className="game-board__lane" />
              ))}
            </div>

            {/* Beat lines every MIN_HEIGHT px */}
            {beatLines.map(({ y, beat, timeS }) => (
              <div key={y} className="game-board__beat-line" style={{ top: y }}>
                <span className="game-board__beat-label">{beat} · {timeS.toFixed(3)}s</span>
              </div>
            ))}
          </div>

          {/* ── Tile layer (foreground) ── */}
          <div className="game-board__tile-layer">
            {Array.from(byLane.entries()).map(([laneIndex, laneTiles]) => (
              <div
                key={laneIndex}
                className={`game-board__tile-lane game-board__tile-lane--${laneIndex}`}
              >
                {/* START tile lives in lane 0 at beat 0 */}
                {laneIndex === 0 && (
                  <div
                    className={`game-tile game-tile--start ${started ? 'game-tile--tapped' : ''}`}
                    style={{ top: startTileTop, height: MIN_HEIGHT }}
                    onPointerDown={(e) => { e.preventDefault(); if (!started) handleStart(); }}
                  >
                    START
                  </div>
                )}
                {laneTiles.map(tile => (
                  tile.height > MIN_HEIGHT
                    ? <HoldTileCard
                        key={tile.id}
                        tile={tile}
                        tapped={tappedIds.has(tile.id)}
                        onTap={handleTileTap}
                        onRelease={onHoldRelease}
                      />
                    : <GameTileCard
                        key={tile.id}
                        tile={tile}
                        tapped={tappedIds.has(tile.id)}
                        onTap={handleTileTap}
                      />
                ))}
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* Legend */}
      <div className="game-board__legend">
        <span>{isPlaying ? 'playing…' : started ? 'paused' : 'tap START to begin'}</span>
        <span>{info.bpm} BPM · {PX_PER_SEC}px/s</span>
      </div>

    </div>
  );
}
