/**
 * LaneDividerSystem.ts
 *
 * Draws the thin vertical divider lines between the 4 game lanes.
 *
 * RESPONSIBILITY:
 *   Draw 3 static vertical lines at 1/4, 2/4, and 3/4 of the screen width,
 *   matching the CSS __lane border-right: 1px solid rgba(255,255,255,0.3).
 *
 * DOES NOT:
 *   - Know about tiles, scroll, audio, or input.
 *   - Require an update() method — the lines are static once drawn.
 *
 * WHY setScrollFactor(0):
 *   Lane dividers should remain fixed to the screen regardless of camera scroll.
 *   They're visual guides for the player, not world-space objects.
 *
 * WHY a separate class instead of drawing in BackgroundSystem:
 *   SOLID single-responsibility. The background animates; the lane dividers are
 *   static structural UI. Keeping them separate makes each easier to modify
 *   independently (e.g. swapping to a different lane count, changing opacity).
 */

import Phaser from 'phaser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of lanes — must match LANE_COUNT in PianoGameScene. */
const LANE_COUNT = 4;

/**
 * Depth for lane dividers — above the background (depth 0-3) but below tiles (10)
 * and well below the HUD (1000).
 */
const DEPTH_LANE_DIVIDERS = 5;

/**
 * Divider line color. White at 30% opacity — readable against any gradient color
 * but subtle enough not to distract from tiles.
 * Matches the CSS: border-right: 1px solid rgba(255, 255, 255, 0.3)
 */
const DIVIDER_COLOR = 0xffffff;
const DIVIDER_ALPHA = 0.30;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class LaneDividerSystem {
  /** The single Graphics object that contains all 3 divider lines. */
  private readonly graphics: Phaser.GameObjects.Graphics;

  /**
   * @param scene      - The owning Phaser scene.
   * @param gameWidth  - Current canvas width in pixels.
   * @param gameHeight - Current canvas height in pixels.
   */
  constructor(scene: Phaser.Scene, gameWidth: number, gameHeight: number) {
    // WHY one Graphics for all lines:
    //   Drawing all lines into a single Graphics object costs one draw call
    //   instead of three. Since the lines are static, this is optimal.
    this.graphics = scene.add.graphics();

    this.graphics.lineStyle(1, DIVIDER_COLOR, DIVIDER_ALPHA);

    const laneWidth = gameWidth / LANE_COUNT;

    // Draw 3 dividers — between lanes 0/1, 1/2, and 2/3.
    // Lane 4's right edge is the screen edge; no divider needed there.
    for (let i = 1; i < LANE_COUNT; i++) {
      const x = Math.round(laneWidth * i); // round to avoid sub-pixel blurring
      this.graphics.beginPath();
      this.graphics.moveTo(x, 0);
      this.graphics.lineTo(x, gameHeight);
      this.graphics.strokePath();
    }

    // Fixed to screen coordinates — does not scroll with the tile world.
    this.graphics.setScrollFactor(0);
    this.graphics.setDepth(DEPTH_LANE_DIVIDERS);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Destroys the Graphics object owned by this system.
   * Call before recreating LaneDividerSystem on resize.
   */
  destroy(): void {
    this.graphics.destroy();
  }
}
