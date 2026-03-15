/**
 * GameBoardDebugSkin — the developer-facing game board view.
 *
 * PURPOSE:
 *   Shows all the diagnostic information that is hidden in the classic skin:
 *   - Beat lines: one horizontal line per slot row, labelled with beat number
 *     and wall-clock time in seconds. Useful for verifying song timing.
 *   - Note labels on every tile (PT2 notation, e.g. "g2[L]")
 *   - The raw light-grey background that makes grid structure visible
 *
 * HOW TO ACTIVATE:
 *   In the song selection screen, check "Debug Board" before launching a song.
 *   This sets skin="debug" on <GameBoard />, which renders this component.
 *
 * STRUCTURE:
 *   - Outer div: dark #333 shell identical to the classic skin's outer container
 *   - HUD overlay: score counter (top-centre) + back button (top-left)
 *   - game-board__viewport: the scrollable area whose ref drives auto-scroll
 *   - game-board__canvas: full-height div (scaledTotalHeight px) with:
 *       - grid-layer (beat lines + lane separators)
 *       - tile-layer (TileLayer component)
 */

import type { ParsedNote } from '../types/midi';
import type { GameBoardEngine } from '../hooks/useGameBoardEngine';
import { TileLayer } from './TileLayer';

interface Props {
  engine: GameBoardEngine;
  onHoldRelease?: () => void;
  onHoldBeat?: (notes: ParsedNote[]) => void;
  onExit?: () => void;
}

export function GameBoardDebugSkin({ engine, onHoldRelease, onHoldBeat, onExit }: Props) {
  const {
    trackData, scaleRatio, scaledTotalHeight, beatLines,
    started, handleStart, scrollRef, tappedIds, tapTile, viewportH, info,
  } = engine;

  return (
    <div className="game-board" style={{ position: 'relative', height: '100%', width: '100%', background: '#333' }}>

      {/* ── Top HUD ─────────────────────────────────────────────────────────
          Layered above the scroll viewport at z-index 1000.
          pointerEvents:none on the container so the board behind stays tappable;
          individual buttons re-enable pointer events on themselves. */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000,
        pointerEvents: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center',
        padding: '24px 16px',
      }}>
        {/* Back button: fades to 60% opacity once the game starts so it's less
            distracting, but remains tappable in case the player wants to quit. */}
        <button
          className="back-btn"
          onClick={onExit}
          style={{
            position: 'absolute', left: 16, top: 24,
            background: 'none', border: 'none', cursor: 'pointer', pointerEvents: 'auto',
            opacity: started ? 0.6 : 1, transition: 'opacity 0.3s',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
          }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>

        {/* Score: counts tapped tiles. Styled like the original game (red text, white stroke). */}
        <div style={{
          fontSize: '48px', fontWeight: 'bold', color: '#ff4b4b',
          WebkitTextStroke: '1.5px #fff',
          textShadow: '0px 2px 4px rgba(0,0,0,0.5)',
          fontFamily: 'Arial, sans-serif', lineHeight: 1, marginTop: 8,
        }}>
          {tappedIds.size}
        </div>
      </div>

      {/* ── Scroll viewport ─────────────────────────────────────────────────
          scrollRef is attached here — useAutoScroll drives scrollTop on this element.
          Before START: overflowY:scroll lets the player manually inspect the track.
          After START:  overflowY:hidden disables manual scroll; auto-scroll takes over.
          touchAction:none after start prevents the browser from intercepting
          pointer events needed for tile tapping on mobile. */}
      <div
        className="game-board__viewport"
        ref={scrollRef}
        onContextMenu={e => e.preventDefault()}
        style={{
          touchAction: started ? 'none' : 'auto',
          overflowY: started ? 'hidden' : 'scroll',
        }}
      >
        {/* Only render the canvas once viewportH is known (avoids a flash at 0px height). */}
        {viewportH > 0 && (
          <div className="game-board__canvas" style={{ height: scaledTotalHeight }}>

            {/* ── Grid layer (behind tiles) ─────────────────────────────────
                Contains lane dividers and beat lines.
                pointer-events:none so it doesn't block tile taps. */}
            <div className="game-board__grid-layer">
              {/* Vertical lane separators */}
              <div className="game-board__lanes">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="game-board__lane" />
                ))}
              </div>

              {/* Horizontal beat lines — one per slot row.
                  Each line shows the beat index and its wall-clock time.
                  Computed by useGameBoardEngine from trackData.totalRows. */}
              {beatLines.map(({ y, beat, timeS }) => (
                <div key={y} className="game-board__beat-line" style={{ top: y }}>
                  <span className="game-board__beat-label">{beat} · {timeS.toFixed(3)}s</span>
                </div>
              ))}
            </div>

            {/* ── Tile layer (foreground) ───────────────────────────────────
                TileLayer iterates the Card[] and renders each card type.
                It's a shared component — also used by GameBoardClassicSkin. */}
            <div
              className="game-board__tile-layer"
              style={{ display: 'flex', flexDirection: 'column-reverse', width: '100%', height: '100%' }}
            >
              <TileLayer
                cards={trackData.cards}
                scaleRatio={scaleRatio}
                tappedIds={tappedIds}
                tapTile={tapTile}
                started={started}
                onStart={handleStart}
                onHoldRelease={onHoldRelease}
                onHoldBeat={onHoldBeat}
                songName={info.name}
              />
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
