/**
 * HUDSystem.ts
 *
 * Renders the in-game heads-up display: score, back button, song title,
 * START tile, and manual scroll arrows.
 *
 * RESPONSIBILITY:
 *   - Own and display the score counter.
 *   - Own and display the back button, emitting EXIT_GAME when tapped.
 *   - Own and display the START tile (lane-0, bottom of viewport) that
 *     triggers scroll when tapped and hides itself.
 *   - Own and display ▲/▼ arrow buttons for manual one-slot camera nudging
 *     before the song starts (lets the player browse tiles).
 *   - Optionally display the song title beneath the score.
 *   - All elements are pinned to screen coordinates via setScrollFactor(0).
 *
 * DOES NOT:
 *   - Know about tiles, audio, scroll math, or camera logic.
 *   - Know about React — communicates back only via EventBus (EXIT_GAME) or callbacks.
 *
 * WHY setScrollFactor(0) instead of a dedicated HUD camera:
 *   A second camera requires every non-HUD object to be added to the first
 *   camera's ignore list and vice versa. scrollFactor(0) gives us the same
 *   pinned-to-screen result for simple 2D HUD elements with zero camera config.
 *
 * WHY manual pointer hit-test:
 *   Phaser's setInteractive() works in world coordinates. Objects with
 *   setScrollFactor(0) are positioned in world space but rendered in screen
 *   space — the hit area would be offset by camera scroll. We listen to the
 *   scene's global pointerdown and compare pointer.x/y (screen space) against
 *   each element's screen-space bounds directly.
 *
 * LAYOUT:
 *   ┌─────────────────────────────────────────┐
 *   │  ←        [score]   (title)         ▲  │  ← top area
 *   │                                     ▼  │  ← mid area
 *   │             game world                  │
 *   │ [START]                                 │  ← bottom row (lane 0)
 *   └─────────────────────────────────────────┘
 */

import Phaser from 'phaser';
import { EventBus, PianoEvents } from '../EventBus';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Depth for all HUD elements — always on top of everything. */
const DEPTH_HUD = 1000;

/** Back button hit zone: top-left corner of the screen. */
const BTN_X = 12;
const BTN_Y = 14;
const BTN_WIDTH = 52;
const BTN_HEIGHT = 52;

/** Score text style — matches the CSS skin's __score rule. */
const SCORE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontSize: '48px',
  fontFamily: 'Arial, sans-serif',
  fontStyle: 'bold',
  color: '#ff4b4b',
  stroke: '#ffffff',
  strokeThickness: 3,
  shadow: { offsetX: 0, offsetY: 2, color: 'rgba(0,0,0,0.3)', blur: 8, fill: true },
  align: 'center',
};

/** Back-arrow visual style. */
const BACK_ARROW_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontSize: '32px',
  fontFamily: 'Arial, sans-serif',
  color: '#ffffff',
  stroke: '#000000',
  strokeThickness: 3,
  shadow: { offsetX: 0, offsetY: 2, color: 'rgba(0,0,0,0.4)', blur: 8, fill: true },
};

/** ▲/▼ browse arrow style — semi-transparent so they don't distract during play. */
const ARROW_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontSize: '28px',
  fontFamily: 'Arial, sans-serif',
  color: 'rgba(255,255,255,0.85)',
  stroke: '#000000',
  strokeThickness: 2,
};

/** Square hit area size for each arrow button. */
const ARROW_HIT = 48;

// ---------------------------------------------------------------------------
// Helper type
// ---------------------------------------------------------------------------

/** Screen-space AABB hit zone. */
interface HitZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class HUDSystem {
  // ── Core HUD ──────────────────────────────────────────────────────────────
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly fpsText: Phaser.GameObjects.Text;
  private readonly backArrow: Phaser.GameObjects.Text;
  private score = 0;

  // ── Browse arrows ─────────────────────────────────────────────────────────
  private readonly upArrow: Phaser.GameObjects.Text;
  private readonly downArrow: Phaser.GameObjects.Text;
  private readonly upZone: HitZone;
  private readonly downZone: HitZone;

  /**
   * Stored so we can remove the listener exactly in destroy().
   * Phaser's event system requires the same function reference to unsubscribe.
   */
  private readonly globalPointerDownHandler: (pointer: Phaser.Input.Pointer) => void;

  /**
   * @param scene       - The owning Phaser scene.
   * @param gameWidth   - Current canvas width (for centering and lane math).
   * @param gameHeight  - Current canvas height (for bottom-of-screen positioning).
   * @param slotHeight  - One tile slot in screen pixels (MIN_HEIGHT * scaleRatio).
   * @param songTitle   - Optional song name displayed beneath the score.
   * @param onScrollNudge - Called when an arrow is tapped; direction 'up'/'down'.
   */
  constructor(
    scene: Phaser.Scene,
    gameWidth: number,
    gameHeight: number,
    _slotHeight: number,
    _songTitle: string,
    onScrollNudge: (direction: 'up' | 'down') => void,
  ) {
    // ── Score text ───────────────────────────────────────────────────────────
    this.scoreText = scene.add.text(gameWidth / 2, 16, '0', SCORE_STYLE);
    this.scoreText.setOrigin(0.5, 0);
    this.scoreText.setScrollFactor(0);
    this.scoreText.setDepth(DEPTH_HUD);

    // ── FPS Text ─────────────────────────────────────────────────────────────
    this.fpsText = scene.add.text(gameWidth - 12, 16, 'FPS: 0', {
      fontSize: '16px',
      fontFamily: 'monospace',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { x: 6, y: 4 },
      fontStyle: 'bold',
    });
    this.fpsText.setOrigin(1, 0);
    this.fpsText.setScrollFactor(0);
    this.fpsText.setDepth(DEPTH_HUD);
    this.fpsText.setVisible(true);

    // ── Back arrow ───────────────────────────────────────────────────────────
    this.backArrow = scene.add.text(
      BTN_X + BTN_WIDTH / 2,
      BTN_Y + BTN_HEIGHT / 2,
      '←',
      BACK_ARROW_STYLE,
    );
    this.backArrow.setOrigin(0.5, 0.5);
    this.backArrow.setScrollFactor(0);
    this.backArrow.setDepth(DEPTH_HUD);
    this.backArrow.setInteractive();
    this.backArrow.on('pointerdown', () => {
      EventBus.emit(PianoEvents.EXIT_GAME);
    });

    // ── Browse arrows ─────────────────────────────────────────────────────────
    // Placed on the right edge, centered vertically, with 60px between them.
    const arrowCX = gameWidth - 24;
    const upArrowCY = gameHeight / 2 - 40;
    const downArrowCY = gameHeight / 2 + 40;

    this.upZone = { x: arrowCX - ARROW_HIT / 2, y: upArrowCY - ARROW_HIT / 2, w: ARROW_HIT, h: ARROW_HIT };
    this.downZone = { x: arrowCX - ARROW_HIT / 2, y: downArrowCY - ARROW_HIT / 2, w: ARROW_HIT, h: ARROW_HIT };

    this.upArrow = scene.add.text(arrowCX, upArrowCY, '▲', ARROW_STYLE);
    this.upArrow.setOrigin(0.5, 0.5);
    this.upArrow.setScrollFactor(0);
    this.upArrow.setDepth(DEPTH_HUD);

    this.downArrow = scene.add.text(arrowCX, downArrowCY, '▼', ARROW_STYLE);
    this.downArrow.setOrigin(0.5, 0.5);
    this.downArrow.setScrollFactor(0);
    this.downArrow.setDepth(DEPTH_HUD);

    // ── Combined pointer handler ──────────────────────────────────────────────
    // All HUD hit-testing happens here: back button, START tile, and arrows.
    // pointer.x/y are always screen-space, matching our scrollFactor(0) objects.
    this.globalPointerDownHandler = (pointer: Phaser.Input.Pointer) => this.handleGlobalPointer(pointer, onScrollNudge);

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.globalPointerDownHandler);
  }

  /** Helper to check if a pointer is within a given hit zone. */
  private isHit(pointer: Phaser.Input.Pointer, zone: HitZone): boolean {
    const { x, y } = pointer;
    return x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
  }

  /** Handles global pointer down events for elements not using setInteractive(). */
  private handleGlobalPointer(pointer: Phaser.Input.Pointer, onScrollNudge: (direction: 'up' | 'down') => void) {
    // Up arrow — scroll one slot toward the song end.
    if (this.isHit(pointer, this.upZone)) {
      onScrollNudge('up');
      return;
    }

    // Down arrow — scroll one slot toward the song start.
    if (this.isHit(pointer, this.downZone)) {
      onScrollNudge('down');
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Updates the FPS counter. Called per-frame by PianoGameScene. */
  update(scene: Phaser.Scene): void {
    const fps = scene.game.loop.actualFps || 0;
    this.fpsText.setText(`FPS: ${Math.round(fps)}`);
  }

  /**
   * Increments the score by 1 and refreshes the display text.
   * Called by PianoGameScene on each successful tile tap.
   */
  increment(): void {
    this.score += 1;
    this.scoreText.setText(String(this.score));
    EventBus.emit(PianoEvents.SCORE_CHANGED, { score: this.score });
  }

  /** Resets the score to zero. Call when a new song starts. */
  reset(): void {
    this.score = 0;
    this.scoreText.setText('0');
  }

  /** Returns the current score (read-only). */
  getScore(): number {
    return this.score;
  }

  /**
   * Destroys all game objects and removes the pointer listener.
   * Must be called before recreating HUDSystem (e.g. on resize) to prevent
   * stale pointer handlers from firing against destroyed game objects.
   */
  destroy(scene: Phaser.Scene): void {
    scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.globalPointerDownHandler);

    this.scoreText.destroy();
    this.fpsText.destroy();
    this.backArrow.destroy();
    this.upArrow.destroy();
    this.downArrow.destroy();
  }
}
