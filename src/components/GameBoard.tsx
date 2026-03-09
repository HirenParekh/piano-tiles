import { useCallback, useState, useEffect, useMemo } from 'react';
import type { GameTile, MidiParseResult } from '../types/midi';
import { GameTileCard } from './GameTileCard';
import { HoldTileCard } from './HoldTileCard';
import { useGameBoard } from '../hooks/useGameBoard';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { MIN_HEIGHT } from '../utils/midiParser';

interface Props {
  result: MidiParseResult;
  onPlayNote: (tile: GameTile) => void;
  onHoldRelease?: () => void;
}

const LANE_COUNT = 4;

function groupByLane(tiles: GameTile[]): Map<number, GameTile[]> {
  const map = new Map<number, GameTile[]>();
  for (let i = 0; i < LANE_COUNT; i++) map.set(i, []);
  for (const tile of tiles) map.get(tile.lane)?.push(tile);
  return map;
}

export function GameBoard({ result, onPlayNote, onHoldRelease }: Props) {
  const { tappedIds, tapTile, scrollRef } = useGameBoard(onPlayNote);
  const [started, setStarted] = useState(false);
  const speedMultiplier = 1;
  const [viewportH, setViewportH] = useState(600);

  const { tiles, info, totalHeight } = result;
  const byLane = groupByLane(tiles);

  // Measure physical viewport explicitly
  useEffect(() => {
    if (!scrollRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        setViewportH(en.contentRect.height);
      }
    });
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [scrollRef]);

  // Compute scaling: exactly 4 tiles must fit correctly on screen height
  const scaleRatio = (viewportH / 4) / MIN_HEIGHT;
  const scaledTotalHeight = totalHeight * scaleRatio;

  // Use effectiveBpm for scroll speed: TPS = effectiveBpm / 60, px/s = TPS × MIN_HEIGHT × scaleRatio
  const effectiveBpm = info.effectiveBpm ?? info.bpm;
  const slotDurationS = 60 / effectiveBpm;

  // Scale beat lines
  const beatLines: { y: number; beat: number; timeS: number }[] = [];
  for (let y = totalHeight - MIN_HEIGHT, beat = 1; y >= 0; y -= MIN_HEIGHT, beat++) {
    beatLines.push({ y: y * scaleRatio, beat, timeS: beat * slotDurationS });
  }

  // Map scrollSegments correctly scaled
  const scaledScrollSegments = useMemo(() => {
    return info.scrollSegments?.map(s => ({
      ...s,
      startPixel: s.startPixel * scaleRatio,
      endPixel: s.endPixel * scaleRatio,
    }));
  }, [info.scrollSegments, scaleRatio]);

  const { play } = useAutoScroll(scrollRef, {
    pixelsPerSecond: (MIN_HEIGHT / slotDurationS) * scaleRatio,
    speedMultiplier,
    totalHeight: scaledTotalHeight,
    viewportHeight: viewportH,
    scrollSegments: scaledScrollSegments,
  });



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
  const startTileTop = (totalHeight - MIN_HEIGHT) * scaleRatio;

  return (
    <div className="game-board">



      {/* Viewport */}
      <div
        className="game-board__viewport"
        ref={scrollRef}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          touchAction: started ? 'none' : 'auto',
        }}
      >
        <div className="game-board__canvas" style={{ height: scaledTotalHeight }}>

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
                    style={{ top: startTileTop, height: MIN_HEIGHT * scaleRatio }}
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
                      scaleRatio={scaleRatio}
                      onTap={handleTileTap}
                      onRelease={onHoldRelease}
                    />
                    : <GameTileCard
                      key={tile.id}
                      tile={tile}
                      tapped={tappedIds.has(tile.id)}
                      scaleRatio={scaleRatio}
                      onTap={handleTileTap}
                    />
                ))}
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* Bottom Info */}
      <div className="game-board__bottom-info">
        <div className="song-title">{info.name}</div>
        <div className="song-author">Unknown Author</div>
      </div>

    </div>
  );
}
