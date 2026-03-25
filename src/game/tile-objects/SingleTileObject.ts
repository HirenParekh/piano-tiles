/**
 * SingleTileObject.ts
 *
 * Phaser game object for a single-note tile (one note, one slot tall).
 *
 * RESPONSIBILITY:
 *   Render one filled rectangle representing a tappable tile, and apply a
 *   visual "tapped" state when the player touches it.
 *
 * DOES NOT:
 *   - Play audio (EventBus handles that).
 *   - Track score.
 *   - Animate on tap (animations are a Classic-skin concern, Step 6).
 *
 * VISUAL:
 *   A single filled Phaser.GameObjects.Rectangle, inset by TILE_VISUAL_GAP
 *   on all sides so adjacent tiles have a visible gap between them.
 *   The fill color is TILE_FILL_COLOR (neon green) until tapped, then TILE_TAPPED_COLOR.
 */

import Phaser from 'phaser';
import type { GameTile } from '../../types/midi';
import { BaseTileObject, TILE_VISUAL_GAP } from './BaseTileObject';
import { SingleTileRippleAnimation } from '../animations/SingleTileRippleAnimation';

// ---------------------------------------------------------------------------
// Color constants
// ---------------------------------------------------------------------------

/**
 * Default fill color for untapped single tiles.
 * Using neon green ($accent) so tiles are clearly visible in the Step 2 debug view.
 * The Classic skin (Step 6) will override this with the proper dark tile style.
 */
const TILE_FILL_COLOR = 0x1a1a1a; // #1a1a1a — black tile matching CSS classic skin

/**
 * Corner radius for the tile rectangle.
 * A small radius (4px) softens the tile edges without looking too round.
 * Zero for now (Phaser Rectangle doesn't support border-radius natively;
 * rounded corners require Graphics or RenderTexture — added in Step 6).
 */
// Placeholder — Phaser.GameObjects.Rectangle does not support border-radius.
// This constant documents intent for the Classic skin step.
// const TILE_CORNER_RADIUS = 4;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class SingleTileObject extends BaseTileObject {
  /** The visible rectangle child. Stored so onTap() can change its fill color. */
  private readonly rect: Phaser.GameObjects.Rectangle;

  /**
   * @param scene      - The owning Phaser scene.
   * @param worldX     - World X of the tile's top-left corner.
   * @param worldY     - World Y of the tile's top-left corner.
   * @param tileWidth  - Full lane width (gap is applied visually, not to hit box).
   * @param tileHeight - Full tile height in world pixels.
   * @param tile       - The source GameTile.
   */
  constructor(
    scene: Phaser.Scene,
    worldX: number,
    worldY: number,
    tileWidth: number,
    tileHeight: number,
    tile: GameTile,
  ) {
    super(scene, worldX, worldY, tileWidth, tileHeight, tile);

    // Create a rectangle that fills the tile bounds minus the visual gap.
    // Origin (0, 0) = top-left corner. In Phaser, Rectangle default origin is (0.5, 0.5)
    // so we must call setOrigin(0, 0) for top-left positioning, OR manually offset
    // by half-width/half-height. We use offset because Container children are positioned
    // relative to the container's origin (which is the tile's top-left corner).
    //
    // Inset the rect by TILE_VISUAL_GAP on all sides:
    //   x offset: TILE_VISUAL_GAP
    //   y offset: TILE_VISUAL_GAP
    //   effective width:  tileWidth  - 2 * TILE_VISUAL_GAP
    //   effective height: tileHeight - 2 * TILE_VISUAL_GAP
    //
    // Rect (x, y) is its CENTER, so we add half the effective dimensions:
    const visW = tileWidth - 2 * TILE_VISUAL_GAP;
    const visH = tileHeight - 2 * TILE_VISUAL_GAP;
    const rectCX = TILE_VISUAL_GAP + visW / 2;
    const rectCY = TILE_VISUAL_GAP + visH / 2;

    this.rect = scene.add.rectangle(rectCX, rectCY, visW, visH, TILE_FILL_COLOR);

    // Add the rectangle as a child of this container.
    this.add(this.rect);
  }

  // ---------------------------------------------------------------------------
  // BaseTileObject implementation
  // ---------------------------------------------------------------------------

  getTileType(): 'SINGLE' {
    return 'SINGLE';
  }

  /**
   * Visual tap feedback: dim the tile to show it has been tapped.
   * Audio is handled upstream by the EventBus → PhaserGameBoard → useTileAudio chain.
   */
  onTap(_speedMultiplier?: number, _worldY?: number): void {
    if (this.tapped) return; // Ignore duplicate taps on the same tile.
    this.tapped = true;

    // Use the TileRippleAnimation service, following SOLID separation of concerns
    const visW = this.tileWidth - 2 * TILE_VISUAL_GAP;
    const visH = this.tileHeight - 2 * TILE_VISUAL_GAP;

    SingleTileRippleAnimation.play({
      scene: this.scene,
      container: this,
      originRect: this.rect,
      width: visW,
      height: visH,
      color: TILE_FILL_COLOR,
      duration: 180
    });
  }

  /**
   * Single tiles don't support hold interaction — release is a no-op.
   */
  onRelease(): void {
    // Intentional no-op.
  }
}
