/**
 * BaseTileObject.ts
 *
 * Abstract base class for all renderable tile game objects in the Phaser scene.
 *
 * RESPONSIBILITY:
 *   - Establish the shared interface all tile types must implement.
 *   - Own the world-space position and dimensions of a tile.
 *   - Provide a hit-test helper used by InputSystem (world-coordinate AABB check).
 *   - Store the source GameTile so audio and scoring code can read it.
 *
 * DOES NOT:
 *   - Know about audio playback (handled by React via EventBus).
 *   - Know about scoring (handled by ScoreSystem).
 *   - Know about camera scroll (handled by CameraScrollSystem).
 *
 * WHY Container as the base Phaser type:
 *   A Container lets subclasses add multiple child GameObjects (e.g. body rect +
 *   rounded cap for HoldTileObject) while sharing one world position. The container's
 *   (x, y) is the tile's TOP-LEFT corner in world space.
 *
 * WHY abstract (not interface):
 *   We need shared implementation (containsPoint, markTapped, the tapped flag) that
 *   all subclasses inherit. An interface would require each subclass to re-implement
 *   identical boilerplate.
 */

import Phaser from 'phaser';
import type { GameTile } from '../../types/midi';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Visual gap (in pixels) subtracted from tile bounds on each side.
 * Keeps tiles from touching each other edge-to-edge, matching the CSS grid gap.
 * NOTE: The hit-test box uses the FULL bounds; only the visible rect is inset.
 */
export const TILE_VISUAL_GAP = 0;

/**
 * Fill color applied to any tile after it has been tapped.
 * Using a dark grey signals "already tapped" without hiding the tile.
 */
export const TILE_TAPPED_COLOR = 0x555555;

/**
 * Default fill color for untapped single and double tiles.
 * Exported so SingleTileObject and DoubleTileObject both reference
 * this single constant — one change here updates both tile types.
 */
export const TILE_FILL_COLOR = 0x1a1a1a; // #1a1a1a — black tile matching CSS classic skin

// ---------------------------------------------------------------------------
// Abstract base class
// ---------------------------------------------------------------------------

export abstract class BaseTileObject extends Phaser.GameObjects.Container {
  /**
   * The source GameTile from the parser.
   * Contains lane, slotStart, slotSpan, notes[], and id.
   * Read by InputSystem to emit the correct payload on tap.
   */
  protected readonly gameTile: GameTile;

  /**
   * Full pixel width of this tile's bounding box (= laneWidth, unscaled for gap).
   * Stored separately because Container.getBounds() is expensive to call every frame.
   */
  readonly tileWidth: number;

  /**
   * Full pixel height of this tile's bounding box (= slotSpan * MIN_HEIGHT * scaleRatio).
   */
  readonly tileHeight: number;

  /** Whether the player has already tapped this tile in the current playthrough. */
  protected tapped = false;

  /**
   * @param scene      - The owning Phaser scene.
   * @param worldX     - World-space X of the tile's TOP-LEFT corner (= lane * laneWidth).
   * @param worldY     - World-space Y of the tile's TOP-LEFT corner (= tile.top * scaleRatio).
   * @param tileWidth  - Full width including gap pixels.
   * @param tileHeight - Full height including gap pixels.
   * @param tile       - The source GameTile; stored for read-only access by systems.
   */
  constructor(
    scene: Phaser.Scene,
    worldX: number,
    worldY: number,
    tileWidth: number,
    tileHeight: number,
    tile: GameTile,
  ) {
    // Container positions itself at (worldX, worldY); children are offset from there.
    super(scene, worldX, worldY);

    this.gameTile = tile;
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;

    // Register this container with the scene's display list so Phaser renders it.
    scene.add.existing(this);

    // Ensure tiles render above all background layers (depth 0-5) and below
    // the HUD (depth 1000). Background systems use depths 0-5 explicitly;
    // tile depth 10 keeps them consistently on top of the visual background.
    this.setDepth(10);
  }

  // ---------------------------------------------------------------------------
  // Abstract methods — subclasses define tile-type-specific behavior
  // ---------------------------------------------------------------------------

  /**
   * Called by InputSystem when the player taps this tile.
   * Subclasses apply visual feedback (color change, fill animation, etc.).
   *
   * @param speedMultiplier - Current playback speed (1 = normal, 0.5 = half speed).
   * @param worldY          - Optional physical Y coordinate of the pointer tap in world space.
   * @param slotDurationMs  - Musical duration of one tile slot in milliseconds.
   */
  abstract onTap(speedMultiplier?: number, worldY?: number, slotDurationMs?: number): void;

  /**
   * Called by InputSystem when the player releases a held tile (pointerup / cancel).
   * For non-hold tiles this is a no-op; HoldTileObject cancels its fill animation.
   */
  abstract onRelease(): void;

  /**
   * Returns a string key identifying the tile variant.
   * Used by TileObjectFactory and debug overlays.
   */
  abstract getTileType(): 'SINGLE' | 'HOLD' | 'DOUBLE';

  // ---------------------------------------------------------------------------
  // Public helpers
  // ---------------------------------------------------------------------------

  /** Returns the source GameTile. Callers must not mutate it. */
  getGameTile(): GameTile {
    return this.gameTile;
  }

  /** True after onTap() has been called at least once. */
  isTapped(): boolean {
    return this.tapped;
  }

  /**
   * Returns true if the given WORLD-SPACE point falls within this tile's bounding box.
   *
   * WHY manual AABB instead of Phaser's built-in interactive system:
   *   `setInteractive()` requires Phaser to build per-object hit areas and fires events
   *   asynchronously. For a music game we need zero-latency synchronous hit detection,
   *   so InputSystem performs a direct AABB test across all visible tiles each frame.
   *
   * @param worldX - World X from camera.getWorldPoint().
   * @param worldY - World Y from camera.getWorldPoint().
   */
  containsPoint(worldX: number, worldY: number): boolean {
    // ── Tap Tolerance (matching the legacy CSS ::before pseudo-element) ──
    // The visual tile height can span multiple slots. The tolerance is strictly
    // based on 25% of a SINGLE slot height, exactly like the original app.
    const slotSpanMultiplier = Math.max(1, Math.round(this.gameTile.slotSpan));
    const singleSlotHeight = this.tileHeight / slotSpanMultiplier;
    const toleranceY = singleSlotHeight * 0.25;

    // this.x / this.y are the container's world position (top-left corner).
    return (
      worldX >= this.x &&
      worldX < this.x + this.tileWidth &&
      worldY >= this.y - toleranceY &&
      worldY < this.y + this.tileHeight + toleranceY
    );
  }

  // ---------------------------------------------------------------------------
  // Debug helpers
  // ---------------------------------------------------------------------------

  /**
   * Adds note-name labels to this tile — mirrors the CSS debug skin's tile labels.
   *
   * Shows PT2 notation (e.g. "g2[L]") for each note in the tile, one line per note.
   * The primary note is full-opacity white; additional chord/hold notes are dimmer.
   * Labels are pinned to the tile's world position (they scroll with the tile).
   *
   * WHY a separate opt-in method (not part of the constructor):
   *   Debug labels impose a per-tile Text object allocation. Keeping them out of the
   *   constructor ensures zero overhead in non-debug builds. PianoGameScene calls this
   *   after creating tile objects when `songData.debug === true`.
   *
   * @param fontSize - Text size in pixels; caller passes scaleRatio-adjusted value.
   */
  addNoteLabels(fontSize: number): void {
    const cx = this.tileWidth / 2;
    const cy = this.tileHeight / 2;

    // Build the label string: one line per note, primary note first.
    const lines = this.gameTile.notes.map(n => n.pt2Notation ?? n.name);
    const label = lines.join('\n');

    const text = this.scene.add.text(cx, cy, label, {
      fontSize: `${Math.max(8, Math.round(fontSize))}px`,
      fontFamily: 'monospace',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
      align: 'center',
    });
    text.setOrigin(0.5, 0.5);

    // Dim lines after the first so chord/secondary notes are visually subordinate.
    if (lines.length > 1) {
      text.setAlpha(0.85);
    }

    this.add(text);
  }

  // ---------------------------------------------------------------------------
  // Protected helpers for subclasses
  // ---------------------------------------------------------------------------

  /**
   * Marks this tile as tapped and applies the shared tapped color to all
   * Rectangle children. Subclasses call this inside their onTap() override.
   */
  protected markTapped(): void {
    this.tapped = true;
    this.each((child: Phaser.GameObjects.GameObject) => {
      if (child instanceof Phaser.GameObjects.Rectangle) {
        child.setFillStyle(TILE_TAPPED_COLOR);
      }
    });
  }
}
