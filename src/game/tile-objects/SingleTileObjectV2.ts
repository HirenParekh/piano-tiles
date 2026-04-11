/**
 * SingleTileObjectV2.ts
 *
 * Upgraded Phaser game object for a single-note tile using sprite assets.
 */

import Phaser from 'phaser';
import type { GameTile } from '../../types/midi';
import { BaseTileObject, TILE_VISUAL_GAP } from './BaseTileObject';

export class SingleTileObjectV2 extends BaseTileObject {
  /** The main visual body of the tile. */
  private readonly bodySprite: Phaser.GameObjects.Sprite;
  
  // Store dimensions for consistent sizing during texture swaps
  private readonly visW: number;
  private readonly visH: number;

  constructor(
    scene: Phaser.Scene,
    worldX: number,
    worldY: number,
    tileWidth: number,
    tileHeight: number,
    tile: GameTile,
  ) {
    super(scene, worldX, worldY, tileWidth, tileHeight, tile);

    this.visW = tileWidth - 2 * TILE_VISUAL_GAP;
    this.visH = tileHeight - 2 * TILE_VISUAL_GAP;
    
    const cx = tileWidth / 2;
    const cy = tileHeight / 2;

    this.bodySprite = scene.add.sprite(cx, cy, 'tile-black');
    // Forcing display size is more robust than setScale when textures have different dimensions
    this.bodySprite.setDisplaySize(this.visW, this.visH);

    this.add(this.bodySprite);
  }

  getTileType(): 'SINGLE' | 'DOUBLE' {
    return 'SINGLE';
  }

  onTap(_speedMultiplier = 1, _worldY?: number, _slotDurationMs = 0): void {
    if (this.tapped) return;
    this.tapped = true;

    // Reset tint/alpha
    this.bodySprite.setTint(0xffffff);
    this.bodySprite.setAlpha(1.0);

    // Play the tap sequence
    this.bodySprite.play('single-tile-tap');

    // On completion, swap to the 'hold-finish' texture
    this.bodySprite.once('animationcomplete-single-tile-tap', () => {
      this.bodySprite.setTexture('hold-finish');
      // CRITICAL: hold_finish.png is 474px tall (vs 240px for tile_black).
      // We MUST re-enforce the display size or the tile will "jump" in height.
      this.bodySprite.setDisplaySize(this.visW, this.visH);
    });
  }

  onRelease(): void {
    // No-op for single tiles.
  }
}
