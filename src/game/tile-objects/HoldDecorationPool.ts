/**
 * HoldDecorationPool.ts
 *
 * A scene-level object pool that manages tap-time decoration sprites
 * for hold tiles: beat dots and sonar ripples.
 *
 * WHY a scene-level pool instead of per-tile objects:
 *   If every HoldTileObject owned its own dots and ripple arcs,
 *   a song with 30 hold tiles would have ~180 permanently allocated objects
 *   sitting in Phaser's display list even before the player taps anything.
 *   Phaser traverses every display-list object every frame to compute world
 *   transforms — invisible objects still cost traversal time.
 *
 *   Instead, THIS pool owns a small fixed set of decoration sprites (enough for
 *   the maximum number of simultaneous holds in any song, typically 2–3).
 *   Each sprite starts invisible and off-screen. When a tile is tapped,
 *   it borrows what it needs. When the hold ends or the tween completes, the
 *   sprite is returned to the pool and hidden again.
 *
 * POOL SIZES:
 *   - Dots:    9  (up to 3 dots per hold × 3 simultaneous holds)
 *   - Ripples: 6  (up to 2 ripples per hold × 3 simultaneous holds)
 *   Total: 15 objects — vs. 180+ in the old per-tile approach.
 *
 * USAGE:
 *   const pool = new HoldDecorationPool(scene);
 *   // Inside HoldTileObject.onTap():
 *   const dot = pool.borrowDot();
 *   if (dot) { dot.image.setPosition(x, y); dot.image.setVisible(true); }
 *   // Inside tween onComplete:
 *   pool.returnItem(dot);
 */

import Phaser from 'phaser';
import { holdTextureKey } from './HoldTileTextures';

// ---------------------------------------------------------------------------
// Pool item types
// ---------------------------------------------------------------------------

/** A pooled dot image that can be borrowed for a secondary beat indicator. */
export interface PooledDot {
  image: Phaser.GameObjects.Image;
  inUse: boolean;
}

/** A pooled ripple image that can be borrowed for the sonar ripple effect. */
export interface PooledRipple {
  image: Phaser.GameObjects.Image;
  inUse: boolean;
}

// ---------------------------------------------------------------------------
// Pool sizes
// ---------------------------------------------------------------------------

/** Max simultaneous beat-dot decorations (3 dots/hold × 3 holds) */
const DOT_POOL_SIZE     = 9;
/** Max simultaneous ripple animations (2 ripples/hold × 3 holds) */
const RIPPLE_POOL_SIZE  = 6;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class HoldDecorationPool {
  private readonly dots:    PooledDot[];
  private readonly ripples: PooledRipple[];

  /**
   * Creates all pooled sprites and registers them with the scene.
   * All sprites start invisible and at position (0, 0) in world space.
   * They are re-positioned by the borrowing tile before being made visible.
   *
   * @param scene     - The owning Phaser scene.
   * @param laneWidth - Used to derive the correct width-specific texture keys.
   */
  constructor(scene: Phaser.Scene, laneWidth: number) {
    const visW   = Math.round(laneWidth);

    // ── Dot sprites ────────────────────────────────────────────────────────
    // Pre-allocate beat-dot images. These are positioned inside the tile body.
    this.dots = [];
    for (let i = 0; i < DOT_POOL_SIZE; i++) {
      const img = scene.add.image(0, 0, holdTextureKey('dot'));
      img.setVisible(false);
      img.setDepth(15);
      this.dots.push({ image: img, inUse: false });
    }

    // ── Ripple sprites ─────────────────────────────────────────────────────
    // Pre-allocate sonar ripple images. They follow the follower dot position
    // and are scaled up by a tween before being returned to the pool.
    this.ripples = [];
    for (let i = 0; i < RIPPLE_POOL_SIZE; i++) {
      const img = scene.add.image(0, 0, holdTextureKey('ripple'));
      img.setVisible(false);
      img.setDepth(15);
      this.ripples.push({ image: img, inUse: false });
    }

    // Suppress unused warning — visW kept for potential future width-keyed pool items.
    void visW;
  }

  // ---------------------------------------------------------------------------
  // Borrow / return API
  // ---------------------------------------------------------------------------

  /**
   * Borrows an idle dot from the pool.
   * Returns null if all dots are in use.
   */
  borrowDot(): PooledDot | null {
    return this.borrowFrom(this.dots);
  }

  /**
   * Borrows an idle ripple from the pool.
   * Returns null if all ripples are in use.
   */
  borrowRipple(): PooledRipple | null {
    return this.borrowFrom(this.ripples);
  }

  /**
   * Returns a previously borrowed item to the pool.
   * Hides the image and resets its transform so it's clean for the next borrower.
   *
   * @param item - The PooledDot or PooledRipple to return.
   */
  returnItem(item: PooledDot | PooledRipple): void {
    item.image.setVisible(false);
    item.image.setScale(1);
    item.image.setAlpha(1);
    item.inUse = false;
  }

  /**
   * Destroys all game objects owned by this pool.
   * Call before recreating the pool on scene resize.
   */
  destroy(): void {
    for (const dot    of this.dots)    dot.image.destroy();
    for (const ripple of this.ripples) ripple.image.destroy();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Finds the first idle item in the given pool array and marks it in-use.
   * Returns null if every item is currently busy — callers must handle this case.
   */
  private borrowFrom<T extends { inUse: boolean }>(pool: T[]): T | null {
    for (const item of pool) {
      if (!item.inUse) {
        item.inUse = true;
        return item;
      }
    }
    return null; // all slots busy — caller should skip the visual gracefully
  }
}
