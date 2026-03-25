/**
 * InputSystem.ts
 *
 * Detects which tile (if any) the player is touching and fires callbacks.
 *
 * RESPONSIBILITY:
 *   - Subscribe to Phaser pointer events (pointerdown / pointerup).
 *   - For each pointer-down, convert screen coordinates to world coordinates
 *     and perform an AABB hit test against all active tile objects.
 *   - Call onTileTap(tileObject) for the first hit tile on each pointer.
 *   - Call onTileRelease(tileObject) on pointer-up for any tile being held.
 *   - Support up to 4 simultaneous touches (Phaser default is 2 pointers;
 *     we add two extra for 4-lane simultaneous play).
 *
 * DOES NOT:
 *   - Play audio — callers (PianoGameScene) handle that via EventBus.
 *   - Track score — ScoreSystem handles that.
 *   - Know about the DOM or React.
 *
 * WHY manual AABB hit testing instead of Phaser's setInteractive():
 *   setInteractive() uses bounding-box testing per game object but fires
 *   events asynchronously through Phaser's event queue. For a music game
 *   every millisecond of tap-to-audio latency matters, so we do synchronous
 *   hit tests inside the pointerdown handler before returning.
 *
 * COORDINATE CONVERSION:
 *   Phaser pointer.x / pointer.y are in screen (canvas CSS) space.
 *   camera.getWorldPoint(x, y) converts them to world space, which is what
 *   BaseTileObject.containsPoint() expects.
 */

import Phaser from 'phaser';
import type { BaseTileObject } from '../tile-objects/BaseTileObject';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Called when a tile is successfully tapped. */
export type TileTapCallback = (tileObject: BaseTileObject, worldY: number) => void;

/** Called when a held tile's pointer is released. */
export type TileReleaseCallback = (tileObject: BaseTileObject) => void;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class InputSystem {
  /** Phaser's input plugin — source of pointer events. */
  private readonly input: Phaser.Input.InputPlugin;

  /** Main camera — used to convert screen → world coordinates. */
  private readonly camera: Phaser.Cameras.Scene2D.Camera;

  /** Returns the current list of tile objects to test against. */
  private readonly getActiveTiles: () => BaseTileObject[];

  /** Fired synchronously when a tile is hit on pointer-down. */
  private readonly onTileTap: TileTapCallback;

  /** Fired synchronously when a pointer is released over (or after tapping) a tile. */
  private readonly onTileRelease: TileReleaseCallback;

  /**
   * Tracks which tile (if any) each active pointer is currently holding.
   * Key = pointer.id (1-based in Phaser). Value = the tile being held.
   *
   * WHY track by pointer id:
   *   We need to know which tile to fire onTileRelease for when a finger lifts.
   *   Phaser's pointerup event gives us the pointer id so we can look it up here.
   */
  private readonly heldTiles = new Map<number, BaseTileObject>();

  /**
   * @param scene          - The owning Phaser scene (provides input plugin + events).
   * @param camera         - The main camera for coordinate conversion.
   * @param getActiveTiles - Returns current tile objects (called on every pointer-down).
   * @param onTileTap      - Callback fired when a tile is hit.
   * @param onTileRelease  - Callback fired when a held tile's pointer is released.
   */
  constructor(
    scene: Phaser.Scene,
    camera: Phaser.Cameras.Scene2D.Camera,
    getActiveTiles: () => BaseTileObject[],
    onTileTap: TileTapCallback,
    onTileRelease: TileReleaseCallback,
  ) {
    this.input = scene.input;
    this.camera = camera;
    this.getActiveTiles = getActiveTiles;
    this.onTileTap = onTileTap;
    this.onTileRelease = onTileRelease;

    this.registerPointers();
    this.registerListeners();
  }

  // ---------------------------------------------------------------------------
  // Private: setup
  // ---------------------------------------------------------------------------

  /**
   * Enables up to 4 simultaneous touch pointers.
   *
   * Phaser creates pointer1 and pointer2 by default. addPointer(2) adds
   * pointer3 and pointer4, giving us 4 total — one per lane.
   */
  private registerPointers(): void {
    this.input.addPointer(2); // 2 more → total 4 active pointers
  }

  /**
   * Subscribes to Phaser's pointer events.
   * Using named methods (not arrow lambdas) so they can be cleanly removed
   * if InputSystem is ever destroyed mid-session.
   */
  private registerListeners(): void {
    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      this.handlePointerDown,
      this,
    );
    this.input.on(
      Phaser.Input.Events.POINTER_UP,
      this.handlePointerUp,
      this,
    );
    this.input.on(
      // POINTER_UP_OUTSIDE fires when the finger lifts outside the canvas.
      // This prevents hold tiles from getting "stuck" if the player slides
      // their finger off the screen edge.
      Phaser.Input.Events.POINTER_UP_OUTSIDE,
      this.handlePointerUp,
      this,
    );
  }

  // ---------------------------------------------------------------------------
  // Private: event handlers
  // ---------------------------------------------------------------------------

  /**
   * Fired by Phaser for every new finger-down or mouse-down event.
   *
   * @param pointer - Phaser Pointer object (contains screen-space x/y and id).
   */
  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    // Convert from canvas/screen space to world space.
    // getWorldPoint accounts for camera scroll and zoom.
    const worldPoint = this.camera.getWorldPoint(pointer.x, pointer.y);

    // Test each active tile for a hit. Stop at the first match per pointer.
    // O(N) where N = number of currently rendered tiles — acceptable since
    // the viewport shows at most ~10–15 tiles at a time.
    const tiles = this.getActiveTiles();
    for (const tileObject of tiles) {
      if (tileObject.isTapped()) continue; // Skip already-tapped tiles.

      if (tileObject.containsPoint(worldPoint.x, worldPoint.y)) {
        // Track this pointer's association with the hit tile (for hold release).
        this.heldTiles.set(pointer.id, tileObject);
        this.onTileTap(tileObject, worldPoint.y);
        break; // One tile per pointer per frame.
      }
    }
  }

  /**
   * Fired when a finger lifts or the pointer leaves the canvas.
   *
   * @param pointer - The pointer that was released.
   */
  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    const heldTile = this.heldTiles.get(pointer.id);
    if (heldTile) {
      this.onTileRelease(heldTile);
      this.heldTiles.delete(pointer.id);
    }
  }

  // ---------------------------------------------------------------------------
  // Public: lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Removes all pointer event listeners.
   * Call this before destroying the scene or restarting with a new song
   * to prevent duplicate listener registration.
   */
  destroy(): void {
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
    this.input.off(Phaser.Input.Events.POINTER_UP, this.handlePointerUp, this);
    this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.handlePointerUp, this);
    this.heldTiles.clear();
  }
}
