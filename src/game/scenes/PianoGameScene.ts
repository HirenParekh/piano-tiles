/**
 * PianoGameScene.ts
 *
 * The main Phaser scene that hosts the piano tiles game board.
 *
 * RESPONSIBILITY:
 *   Orchestration only — this scene creates and wires together systems.
 *   It knows WHAT exists but delegates HOW things work to dedicated system classes:
 *     - BackgroundSystem:      animated gradient, bokeh, floating particles (Step 6).
 *     - LaneDividerSystem:     3 static vertical lines between lanes (Step 6).
 *     - TileObjectFactory:     creates tile game objects from GameTile data.
 *     - ScrollSegmentTracker:  maps playback position to scroll speed.
 *     - CameraScrollSystem:    drives camera.scrollY each frame (Step 3).
 *     - InputSystem:           detects tile taps (Step 4).
 *     - HUDSystem:             score counter + back button (Step 6).
 *
 * DOES NOT:
 *   - Contain rendering logic (belongs in tile objects and system classes).
 *   - Contain scroll math (belongs in CameraScrollSystem / ScrollSegmentTracker).
 *   - Contain audio logic (audio stays in React via EventBus).
 *
 * SCENE LIFECYCLE:
 *   init(data)  — store the LoadSongPayload; called before create().
 *   create()    — build the world (tile objects, systems, camera bounds).
 *   update()    — per-frame tick; delegates to active systems.
 *
 * COORDINATE SYSTEM:
 *   The world is oriented top-to-bottom in Phaser:
 *     worldY = 0            → end of song (top of world)
 *     worldY = worldHeight  → start of song (bottom of world)
 *
 *   The camera starts at scrollY = worldHeight - gameHeight (song beginning visible)
 *   and scrollY decreases toward 0 as the song plays.
 *
 *   Tile worldY derives directly from GameTile.top (which tileBuilder computes as:
 *     tile.top = totalHeight - bottomOffset - height  at scaleRatio=1)
 *   Scaled to world pixels: worldY = tile.top * scaleRatio.
 *
 * SCALE RATIO:
 *   scaleRatio = gameHeight / (VISIBLE_SLOTS * MIN_HEIGHT)
 *   Ensures exactly 4 tile slots fit in the visible viewport height.
 *
 * DEPTH ORDERING (low → high):
 *   0-3   BackgroundSystem (gradient, bokeh, particles)
 *   5     LaneDividerSystem
 *   10    Tile objects (BaseTileObject subclasses)
 *   1000  HUDSystem (score, back button)
 */

import Phaser from 'phaser';
import { MIN_HEIGHT } from '../../utils/tileBuilder';
import { EventBus, PianoEvents } from '../EventBus';
import type { LoadSongPayload } from '../EventBus';
import { TileObjectFactory } from '../tile-objects/TileObjectFactory';
import type { BaseTileObject } from '../tile-objects/BaseTileObject';
import { CameraScrollSystem } from '../systems/CameraScrollSystem';
import { ScrollSegmentTracker } from '../systems/ScrollSegmentTracker';
import { InputSystem } from '../systems/InputSystem';
import { BackgroundSystem } from '../systems/BackgroundSystem';
import { LaneDividerSystem } from '../systems/LaneDividerSystem';
import { HUDSystem } from '../systems/HUDSystem';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of game lanes — always 4 for Piano Tiles. */
const LANE_COUNT = 4;

/**
 * Number of tile slots that must fit vertically in the viewport at all times.
 * scaleRatio = gameHeight / (VISIBLE_SLOTS * MIN_HEIGHT).
 * Matches the value hard-coded in useGameBoardEngine for CSS board parity.
 */
const VISIBLE_SLOTS = 4;

/** Key used to start this scene: this.scene.start(PIANO_GAME_SCENE_KEY, payload). */
export const PIANO_GAME_SCENE_KEY = 'PianoGameScene';

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export class PianoGameScene extends Phaser.Scene {
  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /**
   * Song data received from React via init().
   * Null when the scene is started without data (e.g. dev testing).
   */
  private songData: LoadSongPayload | null = null;

  /**
   * All tile game objects created from songData.tiles.
   * Populated in create(); read by InputSystem for hit testing.
   */
  private tileObjects: BaseTileObject[] = [];

  /**
   * True after the player has tapped the START tile for the first time.
   * Persists across resize so the START tile is not shown again mid-song.
   */
  private gameStarted = false;

  /**
   * Drives camera.scrollY each frame at the musical tempo.
   * Created in create(); null until a song is loaded.
   */
  private cameraScrollSystem: CameraScrollSystem | null = null;

  /**
   * Detects pointer hits on tile objects and fires tap/release callbacks.
   * Created in create() after tileObjects are built.
   */
  private inputSystem: InputSystem | null = null;

  /**
   * Score counter, back button, and song title pinned to screen coordinates.
   * Absorbs the Step-4 ScoreSystem; created whenever a song is loaded.
   */
  private hudSystem: HUDSystem | null = null;

  /**
   * Animated gradient + bokeh + particles background layer.
   * Created in create(); always present even without a song.
   */
  private backgroundSystem: BackgroundSystem | null = null;

  /**
   * Static vertical lines between the 4 lanes.
   * Created in create(); always present even without a song.
   */
  private laneDividerSystem: LaneDividerSystem | null = null;

  /**
   * Pixel scale ratio: how many Phaser world pixels equal one MIN_HEIGHT slot.
   * = gameHeight / (VISIBLE_SLOTS * MIN_HEIGHT)
   * Recomputed on every Phaser.Scale.RESIZE event.
   */
  private scaleRatio = 1;

  /**
   * Container for world-bound Intro and Start cards.
   */
  private startCardObjects: Phaser.GameObjects.GameObject[] = [];

  /**
   * Full height of the Phaser world in pixels.
   * = result.totalHeight * scaleRatio
   * All tiles are positioned within [0, worldHeight].
   */
  private worldHeight = 0;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  constructor() {
    super(PIANO_GAME_SCENE_KEY);
  }

  // -------------------------------------------------------------------------
  // Phaser lifecycle: init
  // -------------------------------------------------------------------------

  /**
   * Receives the song payload before create() is called.
   *
   * Called automatically by Phaser when the scene is started with:
   *   this.scene.start(PIANO_GAME_SCENE_KEY, payload)
   *
   * PhaserGameBoard.tsx triggers this via scene restart.
   *
   * @param data - LoadSongPayload from PhaserGameBoard, or undefined in dev mode.
   */
  init(data: LoadSongPayload | undefined): void {
    // WHY check `data?.result` instead of just `data`:
    // Phaser calls init({}) with an empty object on first boot when no data is
    // passed to scene.start(). An empty object is truthy, so `data ?? null`
    // would assign {} to songData and then `songData.result` would be undefined.
    // Checking for the `result` property distinguishes a real payload from the
    // empty-object default Phaser provides.
    this.songData = data?.result ? (data as LoadSongPayload) : null;
  }

  // -------------------------------------------------------------------------
  // Phaser lifecycle: create
  // -------------------------------------------------------------------------

  /**
   * Builds the entire game world: layout → background → tile objects → systems.
   * Called once by Phaser after init().
   *
   * Creation order follows depth ordering:
   *   1. Compute scale ratio and camera bounds (math setup, no rendering)
   *   2. Background visuals (lowest depth — must be created first)
   *   3. Lane dividers (above background)
   *   4. Tile objects (depth 10 — above both background layers)
   *   5. Scroll + Input systems (no rendering, wire behavior)
   *   6. HUD (topmost depth — created last so it's always on top)
   */
  create(): void {
    // 1. Compute how many Phaser pixels equal one tile slot.
    this.computeScaleRatio();

    // 2. Set camera world bounds and starting scroll position.
    this.setupCamera();

    // 3. Background gradient + bokeh + particles — always visible.
    this.backgroundSystem = new BackgroundSystem(this);

    // 4. Lane dividers — always visible (even without a song loaded).
    this.laneDividerSystem = new LaneDividerSystem(
      this,
      this.scale.width,
      this.scale.height,
    );

    if (this.songData) {
      // 5. Instantiate one game object per tile.
      this.buildTileObjects();

      // 5. Build Intro and Start cards
      this.buildStartCards();

      // 6. Build the scroll system that moves the camera each frame.
      this.buildScrollSystem();

      // 7. Build HUD (score + back button + arrows).
      const songTitle = this.songData.result.info.name ?? '';
      this.hudSystem = new HUDSystem(
        this,
        this.scale.width,
        this.scale.height,
        MIN_HEIGHT * this.scaleRatio,
        songTitle,
        (dir) => this.scrollBySlot(dir),
      );

      // Hide arrows if game already started (during resize)
      if (this.gameStarted) {
        this.cameraScrollSystem?.start();
      }

      // 8. Build input detection — wires pointer events to tile callbacks.
      //    The callback also starts scroll on the very first tile tap so the
      //    player's first touch kicks off both audio and movement together.
      this.inputSystem = new InputSystem(
        this,
        this.cameras.main,
        () => this.tileObjects,
        (tileObject) => this.handleTileTap(tileObject),
        (tileObject) => this.handleTileRelease(tileObject),
      );
    }

    // 9. Recompute layout on window/container resize.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);

    // 10. Signal to PhaserGame.tsx that this scene is ready.
    //     This updates the forwarded ref's `.scene` property.
    EventBus.emit(PianoEvents.CURRENT_SCENE_READY, this);
  }

  // -------------------------------------------------------------------------
  // Phaser lifecycle: update
  // -------------------------------------------------------------------------

  /**
   * Per-frame game loop tick (~60fps).
   * Delegates to active systems — this method contains NO logic of its own.
   *
   * @param _time  - Total elapsed time in ms (unused; systems use delta only).
   * @param delta  - Milliseconds since the last frame (passed to scroll system).
   */
  update(_time: number, delta: number): void {
    // Drive camera upward at musical tempo.
    this.cameraScrollSystem?.update(delta);

    // Update FPS HUD
    this.hudSystem?.update(this);

    // Input is event-driven (no polling needed here).
  }

  // -------------------------------------------------------------------------
  // Public API — consumed by PhaserGameBoard (Step 5)
  // -------------------------------------------------------------------------

  /**
   * Starts the camera scroll. Called when the player taps the START tile.
   */
  startScroll(): void {
    this.cameraScrollSystem?.start();
  }

  /**
   * Pauses scroll (e.g. when the app is backgrounded or the player exits).
   * Resume with startScroll().
   */
  pauseScroll(): void {
    this.cameraScrollSystem?.pause();
  }

  /**
   * Adjusts the playback speed live (e.g. from a speed slider in React).
   * @param multiplier - 1.0 = normal, 0.5 = half speed, 2.0 = double speed.
   */
  setScrollSpeed(multiplier: number): void {
    this.cameraScrollSystem?.setSpeed(multiplier);
  }

  /**
   * Nudges the camera one slot in the given direction.
   * Called by the HUD arrow buttons; only moves while scroll is not playing.
   */
  scrollBySlot(direction: 'up' | 'down'): void {
    const slotPx = MIN_HEIGHT * this.scaleRatio;
    this.cameraScrollSystem?.nudge(direction, slotPx);
  }

  /**
   * Returns all tile objects for the current song.
   * InputSystem uses this list for per-frame hit testing.
   */
  getActiveTiles(): BaseTileObject[] {
    return this.tileObjects;
  }

  /**
   * Returns the current scale ratio (gameHeight / (VISIBLE_SLOTS * MIN_HEIGHT)).
   * Used by Step 7 to compute hold-tile animation durations.
   */
  getScaleRatio(): number {
    return this.scaleRatio;
  }

  // -------------------------------------------------------------------------
  // Private: layout helpers
  // -------------------------------------------------------------------------

  /**
   * Derives scaleRatio from the current Phaser canvas height.
   *
   * scaleRatio = gameHeight / (VISIBLE_SLOTS * MIN_HEIGHT)
   *
   * Example at gameHeight = 600:
   *   scaleRatio = 600 / (4 × 100) = 1.5  → each slot is 150px tall.
   */
  private computeScaleRatio(): void {
    this.scaleRatio = this.scale.height / (VISIBLE_SLOTS * MIN_HEIGHT);
  }

  /**
   * Sizes the world and positions the camera at the song's beginning.
   *
   * The world covers [0, worldWidth] × [0, worldHeight].
   * Camera starts at scrollY = worldHeight - gameHeight, showing the
   * bottom of the world (song start). scrollY = 0 means song end is visible.
   */
  private setupCamera(): void {
    const gameWidth = this.scale.width;
    const gameHeight = this.scale.height;

    this.worldHeight = this.songData
      ? this.songData.result.totalHeight * this.scaleRatio
      : gameHeight * 4; // Blank-board fallback for dev testing.

    // Confine camera so it never scrolls outside the world.
    this.cameras.main.setBounds(0, 0, gameWidth, this.worldHeight);

    // Place camera at the song start (bottom of world).
    const startScrollY = Math.max(0, this.worldHeight - gameHeight);
    this.cameras.main.setScroll(0, startScrollY);
  }

  /**
   * Creates one BaseTileObject per tile in songData.tiles.
   *
   * World position formula:
   *   worldX = tile.lane × laneWidth
   *   worldY = tile.top  × scaleRatio
   *   (tile.top from tileBuilder = totalHeight - bottomOffset - height at scaleRatio=1)
   */
  private buildTileObjects(): void {
    const { tiles, debug } = this.songData!;
    const laneWidth = this.scale.width / LANE_COUNT;

    // Font size scales with the tile slot height so labels are always legible.
    // MIN_HEIGHT * scaleRatio = one slot in screen pixels; 0.18 keeps text
    // comfortably inside a single-slot tile without overflowing.
    const labelFontSize = MIN_HEIGHT * this.scaleRatio * 0.18;

    this.tileObjects = tiles.map((tile) => {
      const obj = TileObjectFactory.createFor(
        this,
        tile,
        tile.lane * laneWidth,
        tile.top * this.scaleRatio,
        laneWidth,
        tile.height * this.scaleRatio,
      );
      if (debug) obj.addNoteLabels(labelFontSize);
      return obj;
    });
  }

  /**
   * Constructs CameraScrollSystem from the loaded song's timing data.
   *
   * Formula cross-check with useGameBoardEngine:
   *   fallbackSlotDurationS = 60 / effectiveBpm
   *   pixelsPerSecond = (MIN_HEIGHT / slotDurationS) * scaleRatio
   *
   * Both are identical to the values passed to useAutoScroll in the CSS board.
   */
  private buildScrollSystem(): void {
    const { result, scrollSegments, speedMultiplier } = this.songData!;
    const effectiveBpm = result.info.effectiveBpm ?? result.info.bpm;
    const fallbackSlotDurationS = 60 / effectiveBpm;

    // ScrollSegmentTracker is a pure utility — no Phaser dependency.
    // It uses raw (unscaled) segments and applies scaleRatio at lookup time.
    const tracker = new ScrollSegmentTracker(
      scrollSegments,        // Raw segments from parser (may be empty).
      fallbackSlotDurationS, // Fallback speed for constant-BPM songs.
    );

    // startScrollY = the camera's initial position (bottom of world).
    const startScrollY = Math.max(0, this.worldHeight - this.scale.height);

    this.cameraScrollSystem = new CameraScrollSystem(
      this.cameras.main,
      tracker,
      startScrollY,
      this.scaleRatio,
      speedMultiplier,
    );
  }

  /**
   * Renders the big blue Intro card and the single START tile at the very bottom
   * of the world. They sit in the 2 empty slots padding the bottom.
   */
  private buildStartCards(): void {
    if (!this.songData) return;

    // Clear existing start objects on resize
    this.startCardObjects.forEach(obj => obj.destroy());
    this.startCardObjects = [];

    const slotPx = MIN_HEIGHT * this.scaleRatio;
    const laneWidth = this.scale.width / LANE_COUNT;
    const songTitle = this.songData.result.info.name || 'Unknown Song';

    // ── 1. Intro Card (bottom-most slot)
    const introY = this.worldHeight - slotPx;
    // Build a nice gradient texture for the banner using Phaser Graphics (or a flat rect)
    const introRect = this.add.rectangle(0, introY, this.scale.width, slotPx, 0x1aaeea).setOrigin(0, 0);
    const titleText = this.add.text(this.scale.width / 2, introY + slotPx / 2 - 12, songTitle, {
      fontSize: '24px', fontStyle: 'bold', color: '#fff'
    }).setOrigin(0.5, 0.5);
    const authorText = this.add.text(this.scale.width / 2, introY + slotPx / 2 + 15, 'Unknown Author', {
      fontSize: '14px', color: '#eeeeee'
    }).setOrigin(0.5, 0.5);

    this.startCardObjects.push(introRect, titleText, authorText);

    // ── 2. START Tile (sits right above Intro Card in lane 0)
    const startTileY = introY - slotPx;
    const startObj = this.add.rectangle(0, startTileY, laneWidth, slotPx, 0x3498db).setOrigin(0, 0);
    const startLabel = this.add.text(laneWidth / 2, startTileY + slotPx / 2, 'START', {
      fontSize: '18px', fontStyle: 'bold', color: '#fff'
    }).setOrigin(0.5, 0.5);

    // If game has already started and we just resized, keep it grey.
    if (this.gameStarted) {
      startObj.fillColor = 0x888888;
    } else {
      startObj.setInteractive();
      startObj.on(Phaser.Input.Events.POINTER_DOWN, () => {
        if (!this.gameStarted) {
          this.gameStarted = true;
          this.startScroll();
          startObj.fillColor = 0x888888; // Grey out tapped tile
        }
      });
    }

    this.startCardObjects.push(startObj, startLabel);
  }

  // -------------------------------------------------------------------------
  // Private: tile interaction handlers (called by InputSystem)
  // -------------------------------------------------------------------------

  /**
   * Called by InputSystem when a tile is tapped.
   *
   * Orchestration order:
   *   1. Start scroll on the very first tap.
   *   2. Tell the tile object to apply visual feedback (color change / animation).
   *   3. Increment the score.
   *   4. Emit TILE_TAPPED so PhaserGameBoard can call useTileAudio.
   */
  private handleTileTap(tileObject: BaseTileObject): void {
    // Visual feedback — greys out single/double tiles; starts the fill tween
    // and schedules beat timers for hold tiles. speedMultiplier scales all timings.
    tileObject.onTap(this.songData?.speedMultiplier ?? 1);

    // Increment HUD score counter.
    this.hudSystem?.increment();

    // Notify React (PhaserGameBoard) to play audio via useTileAudio.
    EventBus.emit(PianoEvents.TILE_TAPPED, { tile: tileObject.getGameTile() });
  }

  /**
   * Called by InputSystem when a held pointer is released.
   * Passes through to the tile object; HoldTileObject will cancel its animation.
   * Also emits HOLD_RELEASED so PhaserGameBoard can call useTileAudio.handleHoldRelease().
   */
  private handleTileRelease(tileObject: BaseTileObject): void {
    tileObject.onRelease();
    EventBus.emit(PianoEvents.HOLD_RELEASED, { tile: tileObject.getGameTile() });
  }

  // -------------------------------------------------------------------------
  // Private: resize handler
  // -------------------------------------------------------------------------

  /**
   * Fired by Phaser.Scale.Events.RESIZE when the container resizes.
   *
   * Re-lays out the entire scene: recompute ratio → reset camera → rebuild all systems.
   * Game objects are destroyed and recreated because their pixel positions change.
   *
   * Background and HUD systems are also rebuilt so their sizes match the new viewport.
   */
  private onResize(): void {
    this.computeScaleRatio();
    this.setupCamera();

    // Propagate new ratio to the scroll system so speed stays musically correct.
    this.cameraScrollSystem?.setScaleRatio(this.scaleRatio);

    // ── Rebuild background ───────────────────────────────────────────────────
    this.backgroundSystem?.destroy();
    this.backgroundSystem = new BackgroundSystem(this);

    // ── Rebuild lane dividers ────────────────────────────────────────────────
    this.laneDividerSystem?.destroy();
    this.laneDividerSystem = new LaneDividerSystem(
      this,
      this.scale.width,
      this.scale.height,
    );

    // ── Rebuild HUD ──────────────────────────────────────────────────────────
    // Destroy old HUD first so the pointer listener is removed before recreating.
    if (this.hudSystem) {
      this.hudSystem.destroy(this);
      const songTitle = this.songData?.result.info.name ?? '';
      this.hudSystem = new HUDSystem(
        this,
        this.scale.width,
        this.scale.height,
        MIN_HEIGHT * this.scaleRatio,
        songTitle,
        (dir) => this.scrollBySlot(dir),
      );
    }

    // ── Rebuild input ────────────────────────────────────────────────────────
    // Destroy the old InputSystem so it doesn't fire stale pointer events
    // against tile objects that are about to be recreated.
    this.inputSystem?.destroy();
    this.inputSystem = null;

    // ── Recreate tile objects at updated pixel positions ─────────────────────
    this.tileObjects.forEach((obj) => obj.destroy());
    this.tileObjects = [];

    if (this.songData) {
      this.buildTileObjects();
      this.buildStartCards();
      // Rebuild InputSystem so it references the new tileObjects array.
      this.inputSystem = new InputSystem(
        this,
        this.cameras.main,
        () => this.tileObjects,
        (tileObject) => this.handleTileTap(tileObject),
        (tileObject) => this.handleTileRelease(tileObject),
      );
    }
  }
}
