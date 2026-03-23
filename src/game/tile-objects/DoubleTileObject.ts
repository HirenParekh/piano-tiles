/**
 * DoubleTileObject.ts
 *
 * Phaser game object for a double tile (two tiles that appear simultaneously,
 * one in each of two lanes, played at the same time).
 *
 * RESPONSIBILITY:
 *   Render a single-slot tile with a distinct visual style that communicates
 *   "this must be tapped simultaneously with another tile in a paired lane."
 *
 * DOES NOT:
 *   - Know about its paired tile. Each double tile is an independent game object.
 *     The parser assigns them to their respective lanes; they just happen to share
 *     the same slotStart. InputSystem detects both as separate hits.
 *   - Handle audio differently from single tiles (both fire TILE_TAPPED).
 *
 * VISUAL:
 *   A filled rectangle with DOUBLE_FILL_COLOR (red/accent2), visually distinct
 *   from single tiles (green) and hold tiles (cyan).
 *   Future: a small "×2" or double-dot indicator could be added here.
 */

import Phaser from 'phaser';
import type { GameTile } from '../../types/midi';
import { BaseTileObject, TILE_VISUAL_GAP } from './BaseTileObject';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Fill color for double tiles.
 * Red ($accent2) makes paired tiles immediately recognizable.
 */
const DOUBLE_FILL_COLOR = 0xff4d6d; // #ff4d6d — project $accent2

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class DoubleTileObject extends BaseTileObject {
  /** The visible rectangle child. */
  private readonly rect: Phaser.GameObjects.Rectangle;

  /**
   * @param scene      - The owning Phaser scene.
   * @param worldX     - World X of the tile's top-left corner.
   * @param worldY     - World Y of the tile's top-left corner.
   * @param tileWidth  - Full lane width.
   * @param tileHeight - Full tile height in world pixels.
   * @param tile       - The source GameTile (tile.note.tileType === 'DOUBLE').
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

    // Same inset+center calculation as SingleTileObject.
    const visW = tileWidth - 2 * TILE_VISUAL_GAP;
    const visH = tileHeight - 2 * TILE_VISUAL_GAP;
    const rectCX = TILE_VISUAL_GAP + visW / 2;
    const rectCY = TILE_VISUAL_GAP + visH / 2;

    this.rect = scene.add.rectangle(rectCX, rectCY, visW, visH, DOUBLE_FILL_COLOR);
    this.add(this.rect);
  }

  // ---------------------------------------------------------------------------
  // BaseTileObject implementation
  // ---------------------------------------------------------------------------

  getTileType(): 'DOUBLE' {
    return 'DOUBLE';
  }

  // speedMultiplier is accepted for interface conformance but not used by double tiles.
  onTap(_speedMultiplier?: number): void {
    if (this.tapped) return;
    this.markTapped();
  }

  /**
   * Double tiles don't support hold — release is a no-op.
   */
  onRelease(): void {
    // Intentional no-op.
  }
}
