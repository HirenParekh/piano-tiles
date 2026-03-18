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

import { useCallback } from 'react';
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
 * Small white particle bubbles that continuously float upward, like the
 * bokeh bubbles visible in the original Piano Tiles 2 background.
 *
 * All particles are placed at top:100% (bottom of screen) and travel upward
 * via the `particleRise` keyframe. Negative animationDelay staggers their
 * starting position so the screen looks populated immediately on load.
 *
 * Formula: a particle with delay=-Ds and duration=Ts starts at height
 *   (D/T) × 110vh above its base position — naturally distributed.
 *
 * Size range: 5–22px (mix of tiny dots and slightly larger orbs, like the game)
 * Opacity: 0.5–0.9 via the keyframe; color is white with slight blue tint
 */
const PARTICLES: { size: number; left: string; duration: number; delay: number }[] = [
  { size:  6,  left:  '8%', duration:  8, delay:  2 },
  { size: 14,  left: '18%', duration: 12, delay:  7 },
  { size:  8,  left: '28%', duration:  9, delay:  4 },
  { size: 20,  left: '35%', duration: 14, delay: 11 },
  { size:  5,  left: '45%', duration:  7, delay:  1 },
  { size: 16,  left: '55%', duration: 11, delay:  9 },
  { size: 10,  left: '62%', duration: 10, delay:  3 },
  { size: 22,  left: '72%', duration: 13, delay:  6 },
  { size:  7,  left: '80%', duration:  8, delay: 12 },
  { size: 12,  left: '90%', duration: 11, delay:  5 },
  { size: 18,  left:  '3%', duration: 15, delay:  8 },
  { size:  9,  left: '50%', duration:  9, delay: 13 },
  { size: 15,  left: '25%', duration: 12, delay:  0 },
  { size:  6,  left: '68%', duration:  7, delay: 10 },
  { size: 11,  left: '42%', duration: 10, delay: 14 },
  { size: 19,  left: '85%', duration: 16, delay:  2 },
  { size:  8,  left: '15%', duration:  8, delay:  6 },
  { size: 13,  left: '58%', duration: 11, delay:  4 },
];

/**
 * Bokeh circle definitions.
 *
 * Key tuning notes:
 *   - `blur` kept at 20-35px (not 50-65px) so circles are actually visible
 *   - `color` opacity 0.6-0.75 so they read against the gradient
 *   - `size` 200-320px for bold presence
 *   - `anim` alternates between 'bokehFloat' (vertical) and 'bokehDrift'
 *     (diagonal) so circles don't all move identically
 *   - negative `delay` staggers the phase so they're not in sync on load
 */
const BOKEH_CIRCLES = [
  { size: 300, left: '-5%',  top: '10%',  color: 'rgba(100,180,255,0.7)',  blur: 28, duration: 14, delay: 0,  anim: 'bokehFloat' },
  { size: 220, left: '60%',  top: '5%',   color: 'rgba(190,130,255,0.65)', blur: 30, duration: 18, delay: 3,  anim: 'bokehDrift' },
  { size: 320, left: '25%',  top: '45%',  color: 'rgba(50,210,255,0.6)',   blur: 32, duration: 22, delay: 7,  anim: 'bokehFloat' },
  { size: 180, left: '78%',  top: '60%',  color: 'rgba(210,150,255,0.7)',  blur: 22, duration: 16, delay: 5,  anim: 'bokehDrift' },
  { size: 260, left: '10%',  top: '70%',  color: 'rgba(80,200,255,0.65)',  blur: 26, duration: 20, delay: 9,  anim: 'bokehFloat' },
  { size: 200, left: '48%',  top: '0%',   color: 'rgba(130,240,255,0.6)',  blur: 24, duration: 25, delay: 11, anim: 'bokehDrift' },
  { size: 160, left: '-2%',  top: '40%',  color: 'rgba(230,190,255,0.65)', blur: 20, duration: 13, delay: 2,  anim: 'bokehFloat' },
  { size: 280, left: '70%',  top: '30%',  color: 'rgba(60,200,255,0.55)',  blur: 34, duration: 19, delay: 6,  anim: 'bokehDrift' },
];

export function GameBoardClassicSkin({ engine, onHoldRelease, onHoldBeat, onExit }: Props) {
  const {
    trackData, scaleRatio, scaledTotalHeight, speedMultiplier,
    started, handleStart, scrollRef, tappedIds, tapTile, viewportH, info,
  } = engine;

  // Attach a non-passive touchstart listener to the canvas so iOS Safari's
  // text-selection magnifier is suppressed even when CSS user-select fails.
  const canvasRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    el.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  }, []);

  return (
    <div
      className="classic-board"
      style={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden' }}
    >
      {/* ── Background gradient ───────────────────────────────────────────
          Shifts slowly through blue/purple/cyan with classicBgShift keyframe. */}
      <div className="classic-board__bg" />

      {/* ── Radial glow overlay ───────────────────────────────────────────
          A large soft glow centered on the board that slowly breathes,
          adding depth to the gradient without blocking tile visibility. */}
      <div className="classic-board__bg-glow" />

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
              // Each circle uses its own keyframe (float vs drift) for variety
              animationName: c.anim,
              animationDuration: `${c.duration}s`,
              // Negative delay starts each circle at a different phase immediately
              animationDelay: `-${c.delay}s`,
            }}
          />
        ))}
      </div>

      {/* ── Floating particle bubbles ─────────────────────────────────────
          Small white circles that drift upward like snow / bokeh orbs.
          Each particle is at top:100% (bottom of screen); negative delay
          places it at a different height so they're distributed immediately. */}
      <div className="classic-board__particles" aria-hidden>
        {PARTICLES.map((p, i) => (
          <div
            key={i}
            className="classic-board__particle"
            style={{
              width: p.size,
              height: p.size,
              left: p.left,
              top: '100%',
              // Slightly blue-tinted white, kept semi-transparent so they blend softly
              background: `rgba(220, 235, 255, 0.5)`,
              animationDuration: `${p.duration}s`,
              animationDelay: `-${p.delay}s`,
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
          <div
            ref={canvasRef}
            style={{ height: scaledTotalHeight, position: 'relative', width: '100%', touchAction: 'none' }}
            onPointerDown={e => e.stopPropagation()}
            onPointerUp={e => e.stopPropagation()}
            onPointerMove={e => e.stopPropagation()}
            onPointerCancel={e => e.stopPropagation()}
            onContextMenu={e => e.preventDefault()}
          >
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
              speed={speedMultiplier}
              scrollRef={scrollRef}
            />
          </div>
        )}
      </div>
    </div>
  );
}
