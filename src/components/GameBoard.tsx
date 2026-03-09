import { useCallback, useState, useEffect, useMemo } from 'react';
import type { MidiParseResult } from '../types/midi';
import type { TileCard, Tile } from '../types/track';
import { GameTileCard } from './GameTileCard';
import { HoldTileCard } from './HoldTileCard';
import { useGameBoard } from '../hooks/useGameBoard';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { MIN_HEIGHT } from '../utils/tileBuilder';
import { buildTrackFromTiles } from '../utils/trackBuilder';

interface Props {
  result: MidiParseResult;
  onPlayNote: (tile: Tile) => void;
  onHoldRelease?: () => void;
}

const LANE_COUNT = 4;

export function GameBoard({ result, onPlayNote, onHoldRelease }: Props) {
  const { tappedIds, tapTile, scrollRef } = useGameBoard(onPlayNote);
  const [started, setStarted] = useState(false);
  const speedMultiplier = 1;
  const [viewportH, setViewportH] = useState(600);

  const { tiles, info } = result;

  const trackData = useMemo(() => {
    return buildTrackFromTiles(tiles);
  }, [tiles]);


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
  // The DOM true height is exclusively derived from TrackBuilder total spans
  const scaledTotalHeight = trackData.totalRows * MIN_HEIGHT * scaleRatio;

  // Use effectiveBpm for scroll speed: TPS = effectiveBpm / 60, px/s = TPS × MIN_HEIGHT × scaleRatio
  const effectiveBpm = info.effectiveBpm ?? info.bpm;
  const slotDurationS = 60 / effectiveBpm;

  // Scale beat lines dynamically syncing to True Flex total rows
  const beatLines: { y: number; beat: number; timeS: number }[] = [];
  for (let i = 1; i < trackData.totalRows; i++) {
    const y = scaledTotalHeight - (i * MIN_HEIGHT * scaleRatio);
    beatLines.push({ y, beat: i, timeS: i * slotDurationS });
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




  return (
    <div className="game-board">



      {/* Viewport */}
      <div
        className="game-board__viewport"
        ref={scrollRef}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          touchAction: started ? 'none' : 'auto',
          overflowY: started ? 'hidden' : 'scroll',
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
          <div className="game-board__tile-layer" style={{
            display: 'flex', flexDirection: 'column-reverse', width: '100%', height: '100%'
          }}>
            {trackData.cards.map((card, i) => {
              const cardH = card.span * MIN_HEIGHT * scaleRatio;

              if (card.type === 'INFO') {
                return (
                  <div key={i} className="" style={{
                    height: cardH, position: 'relative', width: '100%',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    background: '#fff', zIndex: 2
                  }}>
                    <div className="song-title">{info.name}</div>
                    <div className="song-author">Unknown Author</div>
                  </div>
                );
              }

              if (card.type === 'START') {
                return (
                  <div key={i} className="game-board__row" style={{ height: cardH, flexShrink: 0, position: 'relative', pointerEvents: 'none' }}>
                    <div
                      className={`game-tile game-tile--start ${started ? 'game-tile--tapped' : ''}`}
                      style={{
                        position: 'absolute', bottom: 0, height: '100%', width: '25%', left: 0, pointerEvents: 'auto'
                      }}
                      onPointerDown={(e) => { e.preventDefault(); if (!started) handleStart(); }}
                    >
                      START
                    </div>
                  </div>
                );
              }

              if (card.type === 'FINISH') {
                return (
                  <div key={i} className="game-board__track-card--finish" style={{ height: cardH, width: '100%' }}>
                    <div className="checker" style={{ height: '100%', width: '100%', background: 'repeating-linear-gradient(45deg, #eee 0px, #eee 20px, #ccc 20px, #ccc 40px)' }} />
                  </div>
                );
              }

              if (card.type === 'TILE') {
                const tc = card as TileCard;
                return (
                  <div key={i} className="game-board__track-card--tile" style={{
                    height: cardH, width: '100%',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gridTemplateRows: `repeat(${tc.span}, 1fr)`,
                    position: 'relative',
                    pointerEvents: 'none',
                    gap: 0
                  }}>
                    {tc.tiles.map(tile => (
                      tile.type === 'HOLD'
                        ? <HoldTileCard
                          key={tile.id}
                          tile={tile}
                          tapped={tappedIds.has(tile.id)}
                          onTap={tapTile}
                          onRelease={onHoldRelease}
                          className=""
                          style={{
                            top: 'auto', left: 'auto', bottom: 'auto', position: 'relative', height: '100%', width: '100%',
                            margin: 0, padding: 0, pointerEvents: 'auto',
                            gridColumn: tile.lane + 1,
                            gridRow: `${tc.span - tile.rowStart - tile.rowSpan + 1} / span ${tile.rowSpan}`
                          }}
                        />
                        : <GameTileCard
                          key={tile.id}
                          tile={tile}
                          tapped={tappedIds.has(tile.id)}
                          onTap={tapTile}
                          className=""
                          style={{
                            top: 'auto', left: 'auto', bottom: 'auto', position: 'relative', height: '100%', width: '100%',
                            margin: 0, padding: 0, pointerEvents: 'auto',
                            gridColumn: tile.lane + 1,
                            gridRow: `${tc.span - tile.rowStart - tile.rowSpan + 1} / span ${tile.rowSpan}`
                          }}
                        />
                    ))}
                  </div>
                );
              }

              return <div key={i} className="game-board__track-card--empty" style={{ height: cardH, width: '100%', pointerEvents: 'none' }} />;
            })}
          </div>

        </div>
      </div>



    </div>
  );
}
