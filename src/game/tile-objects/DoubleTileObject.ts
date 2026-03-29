/**
 * DoubleTileObject.ts
 *
 * A double tile is visually and behaviourally identical to a SingleTileObject.
 * It extends SingleTileObject directly so ALL rendering, tap animation, and
 * release logic is inherited with zero duplication.
 *
 * The only thing that differs is getTileType() — which returns 'DOUBLE' so the
 * audio system and score system can treat it differently from a regular single.
 *
 * HOW IT WORKS IN THE GAME:
 *   Two DoubleTileObjects appear side-by-side in the same row (different lanes).
 *   The player recognises the "tap both simultaneously" requirement from their
 *   paired position, not from a distinct color. Both look exactly like single tiles.
 *
 * DOES NOT:
 *   - Know about its paired tile (each is an independent game object in its lane).
 *   - Have any unique rendering or animation (all inherited from SingleTileObject).
 */

import type { GameTile } from '../../types/midi';
import type Phaser from 'phaser';
import { SingleTileObject } from './SingleTileObject';

export class DoubleTileObject extends SingleTileObject {
  /**
   * Constructor is identical to SingleTileObject — just passes everything through.
   * All visual setup (rectangle, color) is handled by the parent constructor.
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
  }

  /**
   * Override getTileType() so the audio and scoring systems can distinguish
   * double tiles from single tiles, even though they look identical.
   * Everything else (onTap, onRelease, ripple animation) is inherited as-is.
   */
  getTileType(): 'DOUBLE' {
    return 'DOUBLE';
  }
}
