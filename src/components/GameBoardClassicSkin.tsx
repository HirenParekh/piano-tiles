/**
 * GameBoardClassicSkin — the polished production-ready game board.
 *
 * VISUAL GOALS (matching the original Piano Tiles 2 aesthetic):
 *   - Animated soft blue/purple/cyan gradient background
 *   - Bokeh layer: several large, blurred, semi-transparent circles that slowly
 *     pulse in scale and opacity, giving the dreamy depth-of-field effect
 *   - Thin white semi-transparent vertical lane dividers (no horizontal lines)
 *   - No debug labels on tiles — tiles show only their colour and shape
 *   - Score and back button overlaid at the top
 *
 * HOW THE LAYERS STACK (z-index):
 *   0  __bg          — animated CSS gradient (lowest)
 *   1  __bokeh       — blurred pulsing circles
 *   2  __lanes       — thin lane divider lines
 *   3  __viewport    — scrollable tile canvas (transparent bg so layers 0-2 show through)
 *   1000  HUD        — score + back button (topmost, not clipped by viewport overflow)
 *
 * WHY the viewport is transparent:
 *   The background gradient and bokeh live outside the scroll viewport so they
 *   stay fixed while the tiles scroll. The viewport itself has no background,
 *   letting the decorative layers bleed through.
 *
 * BOKEH DESIGN:
 *   Circles are defined as a static array of objects (size, position, colour,
 *   blur, animation timing). Using inline styles for per-circle values keeps the
 *   SCSS clean while still allowing the shared animation keyframe to be reused.
 *   The `animationDelay` is set to a negative value so each circle starts at a
 *   different phase — they don't all pulse in sync on page load.
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

/**
 * Static bokeh circle definitions.
 * Each circle uses the same CSS keyframe (bokehPulse in _game-board-classic.scss)
 * but different size/position/colour/timing so they feel organic rather than uniform.
 */
const BOKEH_CIRCLES = [
  { size: 180, left: '10%',  top: '15%', color: 'rgba(120,180,255,0.45)', blur: 55, duration: 18, delay: 0 },
  { size: 120, left: '70%',  top: '30%', color: 'rgba(160,120,255,0.35)', blur: 45, duration: 22, delay: 4 },
  { size: 220, left: '40%',  top: '60%', color: 'rgba(80,200,255,0.3)',   blur: 65, duration: 26, delay: 8 },
  { size: 100, left: '85%',  top: '70%', color: 'rgba(180,140,255,0.4)',  blur: 40, duration: 20, delay: 2 },
  { size: 160, left: '20%',  top: '80%', color: 'rgba(100,160,255,0.35)', blur: 50, duration: 24, delay: 6 },
  { size: 140, left: '55%',  top: '10%', color: 'rgba(60,220,255,0.3)',   blur: 48, duration: 28, delay: 10 },
  { size: 90,  left: '5%',   top: '50%', color: 'rgba(200,180,255,0.35)', blur: 38, duration: 16, delay: 3 },
];

export function GameBoardClassicSkin({ engine, onHoldRelease, onHoldBeat, onExit }: Props) {
  const {
    trackData, scaleRatio, scaledTotalHeight,
    started, handleStart, scrollRef, tappedIds, tapTile, viewportH, info,
  } = engine;

  return (
    <div
      className="classic-board"
      style={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden' }}
    >
      {/* ── Background ────────────────────────────────────────────────────
          CSS gradient that slowly shifts between blue, purple, and cyan
          using the classicBgShift keyframe defined in _game-board-classic.scss. */}
      <div className="classic-board__bg" />

      {/* ── Bokeh circles ─────────────────────────────────────────────────
          aria-hidden: purely decorative, screen readers should skip.
          Each circle gets its variable properties (position, size, colour,
          timing) via inline styles; the shared animation is in the SCSS class. */}
      <div className="classic-board__bokeh" aria-hidden>
        {BOKEH_CIRCLES.map((c, i) => (
          <div
            key={i}
            className="classic-board__bokeh-circle"
            style={{
              width: c.size,
              height: c.size,
              left: c.left,
              top: c.top,
              background: c.color,
              filter: `blur(${c.blur}px)`,
              animationDuration: `${c.duration}s`,
              // Negative delay starts each circle at a different phase immediately
              animationDelay: `-${c.delay}s`,
            }}
          />
        ))}
      </div>

      {/* ── Lane dividers ─────────────────────────────────────────────────
          4 columns, each separated by a thin white semi-transparent border.
          aria-hidden: structural decoration only. */}
      <div className="classic-board__lanes" aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="classic-board__lane" />
        ))}
      </div>

      {/* ── Back button ───────────────────────────────────────────────────
          Positioned absolute so it floats above the viewport.
          Fades to 50% opacity after game starts (less distracting), but
          remains fully interactive so the player can exit at any time. */}
      <button
        className="classic-board__back-btn"
        onClick={onExit}
        style={{ opacity: started ? 0.5 : 1 }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      </button>

      {/* ── Score ─────────────────────────────────────────────────────────
          Counts successfully tapped tiles, styled identically to the original
          game (large red text with white stroke). pointer-events:none is set
          via the SCSS class so it doesn't intercept tile taps beneath it. */}
      <div className="classic-board__score">{tappedIds.size}</div>

      {/* ── Scroll viewport ───────────────────────────────────────────────
          Transparent background — layers 0-2 (bg, bokeh, lanes) show through.
          scrollRef is consumed by useAutoScroll to drive scrollTop.
          Scrollbar is hidden via CSS (gameplay-driven scroll only).
          Before START: overflowY:scroll so player can preview the track.
          After START:  overflowY:hidden; auto-scroll takes control. */}
      <div
        className="classic-board__viewport"
        ref={scrollRef}
        onContextMenu={e => e.preventDefault()}
        style={{
          touchAction: started ? 'none' : 'auto',
          overflowY: started ? 'hidden' : 'scroll',
        }}
      >
        {/* Guard: don't render the canvas until viewportH is measured.
            scaleRatio depends on viewportH; rendering at 0 causes wrong tile sizes. */}
        {viewportH > 0 && (
          <div style={{ height: scaledTotalHeight, position: 'relative', width: '100%' }}>
            {/*
             * TileLayer handles all card types (INFO, START, TILE, FINISH, EMPTY).
             * The .classic-board .game-tile__label { display:none } rule in
             * _game-board-classic.scss hides the debug note labels automatically.
             */}
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
        )}
      </div>
    </div>
  );
}
