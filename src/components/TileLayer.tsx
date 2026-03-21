/**
 * TileLayer — shared tile rendering used by every game board skin.
 *
 * WHY it exists:
 *   Both the classic and debug skins render the same tiles. Without this shared
 *   component we'd duplicate ~120 lines of card-iteration logic. Any bug fix or
 *   new tile type only needs to be applied here.
 *
 * HOW it works:
 *   The track is stored as a Card[] (from trackBuilder.ts).
 *   Each Card represents one or more rows in the CSS grid:
 *
 *   Card types:
 *     INFO    — song title banner at the very bottom of the canvas
 *     START   — the "tap to start" tile, one row above INFO
 *     EMPTY   — blank rows (musical gaps / rests)
 *     TILE    — one or more playable tiles sharing the same grid rows
 *     FINISH  — checker-stripe finish line at the very top
 *
 *   Cards are rendered in a column-reverse flex container so the board scrolls
 *   upward — index 0 (INFO) sits at the bottom, FINISH at the top.
 *
 *   TILE cards use CSS grid (4 columns × span rows) to place tiles at their
 *   correct lane and row span without absolute positioning.
 */

import { useMemo, memo } from 'react';
import type { ParsedNote } from '../types/midi';
import type { Card, Tile, TileCard } from '../types/track';
import { GameTileCard } from './GameTileCard';
import { HoldTileCard } from './HoldTileCard';
import { DoubleTileCard } from './DoubleTileCard';
import { MIN_HEIGHT } from '../utils/tileBuilder';

interface Props {
  /** The card array produced by buildTrackFromTiles — drives all rendering. */
  cards: Card[];
  /**
   * CSS pixel scale factor: scaleRatio = (viewportH / 4) / MIN_HEIGHT.
   * Multiply any slot-based pixel value by this to get true CSS px.
   */
  scaleRatio: number;
  /** Called by tile cards on pointer-down; engine calls onPlayNote and toggles DOM class. */
  tapTile: (tile: Tile) => void;
  /** Whether the player has tapped START (gates the START tile's interaction). */
  started: boolean;
  /** Called when the player taps the START tile. */
  onStart: () => void;
  /** Called when a hold tile is released. */
  onHoldRelease?: () => void;
  /** Called on every rhythmic beat tick inside a hold tile. */
  onHoldBeat?: (notes: ParsedNote[]) => void;
  /** Song name shown in the INFO card. */
  songName?: string;
  /** Playback speed multiplier — scales hold-tile beat animations. Defaults to 1. */
  speed?: number;
  // scrollRef removed — HoldTileCard progress is now time-based
}

const LANE_COUNT = 4;

export const TileLayer = memo(function TileLayer({
  cards,
  scaleRatio,
  tapTile,
  started,
  onStart,
  onHoldRelease,
  onHoldBeat,
  songName,
  speed = 1,
}: Props) {
  // Build stable style objects keyed by tile.id — computed once per song load
  // since `cards` is stable for the song's lifetime. This lets React.memo on
  // tile card components do a meaningful shallow prop comparison.
  const tileStyleMap = useMemo(() => {
    const map = new Map<string, React.CSSProperties>();
    for (const card of cards) {
      if (card.type !== 'TILE') continue;
      const tc = card as TileCard;
      for (const tile of tc.tiles) {
        map.set(tile.id, {
          top: 'auto',
          left: 'auto',
          bottom: 'auto',
          position: 'relative',
          height: '100%',
          width: '100%',
          margin: 0,
          padding: 0,
          pointerEvents: 'auto',
          gridColumn: tile.lane + 1,
          gridRow: `${tc.span - tile.rowStart - tile.rowSpan + 1} / span ${tile.rowSpan}`,
        });
      }
    }
    return map;
  }, [cards]);

  return (
    /*
     * column-reverse so Card index 0 (INFO) sits at the visual bottom
     * and the scroll direction is bottom-to-top (board scrolls upward).
     */
    <div style={{ display: 'flex', flexDirection: 'column-reverse', width: '100%', height: '100%' }}>
      {cards.map((card, i) => {
        // Convert slot-rows to CSS pixels using scaleRatio
        const cardH = card.span * MIN_HEIGHT * scaleRatio;

        // ── INFO card ────────────────────────────────────────────────────
        // Decorative banner at the very bottom of the track showing the song name.
        if (card.type === 'INFO') {
          return (
            <div
              key={i}
              style={{
                height: cardH,
                position: 'relative',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(180deg, #74a1ee 0%, #1aaeea 100%)',
                zIndex: 2,
                color: '#fff',
                textShadow: '0 2px 4px rgba(0,0,0,0.2)',
              }}
            >
              <div style={{ fontSize: '24px', fontWeight: 900, letterSpacing: '0.05em' }}>
                {songName ?? 'Unknown Song'}
              </div>
              <div style={{ fontSize: '14px', fontWeight: 500, opacity: 0.8, marginTop: '4px' }}>
                Unknown Author
              </div>
            </div>
          );
        }

        // ── START card ───────────────────────────────────────────────────
        // One tap-target in lane 0. Tapping it calls onStart which fires the
        // auto-scroll loop. After starting, it goes "tapped" (greyed out) so
        // the player can't accidentally restart.
        if (card.type === 'START') {
          return (
            <div
              key={i}
              className="game-board__row"
              style={{ height: cardH, flexShrink: 0, position: 'relative', pointerEvents: 'none' }}
            >
              <div
                className={`game-tile game-tile--start ${started ? 'game-tile--tapped' : ''}`}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  height: '100%',
                  width: `${100 / LANE_COUNT}%`,
                  left: 0,
                  pointerEvents: 'auto',
                }}
                onPointerDown={e => {
                  e.preventDefault();
                  // Guard: only allow one start; after that the tile is inert
                  if (!started) onStart();
                }}
              >
                START
              </div>
            </div>
          );
        }

        // ── FINISH card ──────────────────────────────────────────────────
        // Checker-stripe visual at the top of the track — the finish line.
        if (card.type === 'FINISH') {
          return (
            <div key={i} style={{ height: cardH, width: '100%' }}>
              <div
                style={{
                  height: '100%',
                  width: '100%',
                  background: 'repeating-linear-gradient(45deg, #eee 0px, #eee 20px, #ccc 20px, #ccc 40px)',
                }}
              />
            </div>
          );
        }

        // ── TILE card ────────────────────────────────────────────────────
        // A TILE card groups all tiles that share at least one overlapping row.
        // It renders as a CSS grid:
        //   - 4 columns (one per lane)
        //   - `span` rows (height of the tallest tile in this group)
        //
        // Each tile uses gridColumn and gridRow to place itself inside the grid
        // without absolute positioning, which keeps layout entirely in CSS.
        if (card.type === 'TILE') {
          const tc = card as TileCard;
          return (
            <div
              key={i}
              style={{
                height: cardH,
                width: '100%',
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                // Each row = 1 slot height; tall hold tiles span multiple rows
                gridTemplateRows: `repeat(${tc.span}, 1fr)`,
                position: 'relative',
                // The card itself ignores pointer events; individual tiles opt in
                pointerEvents: 'none',
                gap: 0,
              }}
            >
              {tc.tiles.map(tile => {
                // Each tile type has its own card component:
                //   HOLD     — multi-row tile with laser line, ring, and beat dots
                //   DOUBLE   — simultaneous pair tiles (always rowSpan=1)
                //   SINGLE   — standard one-row tile, all notes play simultaneously
                //   ARPEGGIO — same visual as SINGLE; notes stagger via arpeggioDelayS
                if (tile.type === 'HOLD') {
                  return (
                    <HoldTileCard
                      key={tile.id}
                      tile={tile}
                      onTap={tapTile}
                      onRelease={onHoldRelease}
                      onNotePlay={onHoldBeat}
                      className=""
                      singleTileH={MIN_HEIGHT * scaleRatio}
                      speed={speed}
                      style={tileStyleMap.get(tile.id)}
                    />
                  );
                }
                if (tile.type === 'DOUBLE') {
                  return (
                    <DoubleTileCard
                      key={tile.id}
                      tile={tile}
                      onTap={tapTile}
                      className=""
                      style={tileStyleMap.get(tile.id)}
                    />
                  );
                }
                // Default: SINGLE tile
                return (
                  <GameTileCard
                    key={tile.id}
                    tile={tile}
                    onTap={tapTile}
                    className=""
                    style={tileStyleMap.get(tile.id)}
                  />
                );
              })}
            </div>
          );
        }

        // ── EMPTY card ───────────────────────────────────────────────────
        // Blank spacer rows for musical rests / gaps between note groups.
        // pointerEvents:none so the board stays scrollable through gaps.
        return (
          <div
            key={i}
            style={{ height: cardH, width: '100%', pointerEvents: 'none' }}
          />
        );
      })}
    </div>
  );
});
