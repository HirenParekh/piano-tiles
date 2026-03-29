/**
 * HUDSystem.ts
 *
 * Renders the in-game heads-up display: score counter, back button, and FPS debug counter.
 *
 * RESPONSIBILITY:
 *   - Own and display the score counter.
 *   - Own and display the back button, emitting EXIT_GAME when tapped.
 *   - All elements are pinned to screen coordinates via setScrollFactor(0).
 *
 * DOES NOT:
 *   - Know about tiles, audio, scroll math, or camera logic.
 *   - Know about React — communicates back only via EventBus (EXIT_GAME).
 *
 * WHY setScrollFactor(0) instead of a dedicated HUD camera:
 *   A second camera requires every non-HUD object to be added to the first
 *   camera's ignore list and vice versa. scrollFactor(0) gives us the same
 *   pinned-to-screen result for simple 2D HUD elements with zero camera config.
 *
 * LAYOUT:
 *   ┌─────────────────────────────────────────┐
 *   │  ←   [score]                  FPS: 60  │  ← top bar
 *   │                                         │
 *   │              game world                 │
 *   └─────────────────────────────────────────┘
 */

import Phaser from 'phaser';
import { EventBus, PianoEvents } from '../EventBus';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Depth for all HUD elements — always on top of everything. */
const DEPTH_HUD = 1000;

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

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class HUDSystem {
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly fpsText: Phaser.GameObjects.Text;
  private readonly backArrow: Phaser.GameObjects.Text;
  private score = 0;

  /**
   * @param scene      - The owning Phaser scene.
   * @param gameWidth  - Current canvas width (for centering).
   */
  constructor(
    scene: Phaser.Scene,
    gameWidth: number,
    _gameHeight: number,
    _slotHeight: number,
    _songTitle: string,
  ) {
    // ── Score text ────────────────────────────────────────────────────────────
    this.scoreText = scene.add.text(gameWidth / 2, 16, '0', SCORE_STYLE);
    this.scoreText.setOrigin(0.5, 0);
    this.scoreText.setScrollFactor(0);
    this.scoreText.setDepth(DEPTH_HUD);

    // ── FPS counter ───────────────────────────────────────────────────────────
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

    // ── Back button ───────────────────────────────────────────────────────────
    this.backArrow = scene.add.text(38, 40, '←', BACK_ARROW_STYLE);
    this.backArrow.setOrigin(0.5, 0.5);
    this.backArrow.setScrollFactor(0);
    this.backArrow.setDepth(DEPTH_HUD);
    this.backArrow.setInteractive();
    this.backArrow.on('pointerdown', () => {
      EventBus.emit(PianoEvents.EXIT_GAME);
    });
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

  /** Resets the score to zero. */
  reset(): void {
    this.score = 0;
    this.scoreText.setText('0');
  }

  /** Returns the current score (read-only). */
  getScore(): number {
    return this.score;
  }

  /**
   * Destroys all game objects owned by this HUD.
   * Must be called before recreating HUDSystem (e.g. on resize).
   */
  destroy(_scene: Phaser.Scene): void {
    this.scoreText.destroy();
    this.fpsText.destroy();
    this.backArrow.destroy();
  }
}
