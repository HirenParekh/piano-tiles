/**
 * TileObjectFactory.ts
 *
 * Static factory that maps a GameTile to the correct BaseTileObject subclass.
 *
 * RESPONSIBILITY:
 *   Encapsulate the "which concrete tile class should I create?" decision.
 *   Callers (PianoGameScene) never reference SingleTileObject/HoldTileObject/
 *   DoubleTileObject directly — they always go through this factory.
 *
 * WHY a factory (Open/Closed principle):
 *   Adding a new tile type (e.g. ArpeggioTileObject) requires only:
 *     1. Creating the new subclass.
 *     2. Adding a branch in `createFor()`.
 *   PianoGameScene, InputSystem, and ScoreSystem never change.
 *
 * TILE TYPE RULES — see classifyTile.ts for full documentation.
 *   - DOUBLE: tile.note.tileType === 'DOUBLE'
 *   - HOLD:   tile.slotSpan > 1  (bracket beats ÷ baseBeats > 1)
 *   - SINGLE: everything else
 */

import type Phaser from 'phaser';
import type { GameTile } from '../../types/midi';
import { BaseTileObject } from './BaseTileObject';
import { SingleTileObject } from './SingleTileObject';
import { HoldTileObject } from './HoldTileObject';
import { DoubleTileObject } from './DoubleTileObject';
import { classifyTile } from './classifyTile';
export { classifyTile } from './classifyTile';

export class TileObjectFactory {
  /**
   * Creates the appropriate BaseTileObject for the given GameTile.
   *
   * @param scene      - The Phaser scene that will own the game object.
   * @param tile       - The source tile from the parser.
   * @param worldX     - World X of the tile's top-left corner (= tile.lane * laneWidth).
   * @param worldY     - World Y of the tile's top-left corner (= tile.top * scaleRatio).
   * @param laneWidth  - Pixel width of one lane (= gameWidth / LANE_COUNT).
   * @param tileHeight - Pixel height of this tile (= tile.height * scaleRatio).
   * @returns A concrete BaseTileObject registered with the scene's display list.
   */
  static createFor(
    scene: Phaser.Scene,
    tile: GameTile,
    worldX: number,
    worldY: number,
    laneWidth: number,
    tileHeight: number,
  ): BaseTileObject {
    const type = classifyTile(tile);
    if (type === 'DOUBLE') return new DoubleTileObject(scene, worldX, worldY, laneWidth, tileHeight, tile);
    if (type === 'HOLD')   return new HoldTileObject(scene, worldX, worldY, laneWidth, tileHeight, tile);
    return new SingleTileObject(scene, worldX, worldY, laneWidth, tileHeight, tile);
  }
}
