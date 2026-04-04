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
import { PENDING_SCENE_DATA } from '../PhaserGame';
import type { ParsedNote } from '../../types/midi';
import { TileObjectFactory } from '../tile-objects/TileObjectFactory';
import type { BaseTileObject } from '../tile-objects/BaseTileObject';
import { CameraScrollSystem } from '../systems/CameraScrollSystem';
import { ScrollSegmentTracker } from '../systems/ScrollSegmentTracker';
import { InputSystem } from '../systems/InputSystem';
import { BackgroundSystem } from '../systems/BackgroundSystem';
import { LaneDividerSystem } from '../systems/LaneDividerSystem';
import { HUDSystem } from '../systems/HUDSystem';
import { AudioSystem } from '../systems/AudioSystem';
import { bakeHoldTileTextures } from '../tile-objects/HoldTileTextures';
import { HoldDecorationPool } from '../tile-objects/HoldDecorationPool';

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
   * Score counter and back button pinned to screen coordinates.
   */
  private hudSystem: HUDSystem | null = null;

  /**
   * Animated gradient + bokeh + particles background layer.
   */
  private backgroundSystem: BackgroundSystem | null = null;

  /**
   * Static vertical lines between the 4 lanes.
   */
  private laneDividerSystem: LaneDividerSystem | null = null;

  /**
   * Diagnostic counters for identifying dropped input events.
   */
  private nativeTapsCount = 0;
  private phaserTapsCount = 0;
  private lastHitType = 'None';
  private onNativeDownBound: (e: Event) => void = () => {};
  private isDevMode = false;

  /**
   * Pixel scale ratio: gameHeight / (VISIBLE_SLOTS * MIN_HEIGHT).
   * Recomputed on every Phaser.Scale.RESIZE event.
   */
  private scaleRatio = 1;

  /** Low-latency audio playback system. */
  private audioSystem: AudioSystem | null = null;

  /**
   * Scene-level pool of decoration sprites for hold tiles.
   */
  private holdDecorationPool: HoldDecorationPool | null = null;

  /**
   * Container for world-bound Intro and Start cards.
   */
  private startCardObjects: Phaser.GameObjects.GameObject[] = [];

  /**
   * Full height of the Phaser world in pixels.
   */
  private worldHeight = 0;

  /** Track if browse-scroll listeners are currently attached to the input plugin. */
  private browseScrollRegistered = false;

  // ── Browse-scroll state (drag + wheel before game starts) ──────────────────

  /**
   * Screen-Y captured at pointer-down; used to compute drag delta.
   * -1 when no drag is in progress.
   */
  private dragStartY = -1;

  /**
   * Camera scrollY at the moment the drag started.
   * Combined with dragStartY to compute the new scrollY each frame.
   */
  private dragStartScrollY = 0;

  /** Bound references so we can remove the exact same function on cleanup. */
  private readonly onBrowseDragStart = (p: Phaser.Input.Pointer) => this.handleBrowseDragStart(p);
  private readonly onBrowseDragMove  = (p: Phaser.Input.Pointer) => this.handleBrowseDragMove(p);
  private readonly onBrowseDragEnd   = ()                         => this.handleBrowseDragEnd();
  private readonly onBrowseWheel     = (
    _p: Phaser.Input.Pointer,
    _gx: number,
    _gy: number,
    deltaY: number,
  ) => this.handleBrowseWheel(deltaY);

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
    // 1. If data is empty (Phaser boot default), check the 'Tunnel' registry 
    // for synchronous initial data passed from the React bridge.
    if (!data?.result && PENDING_SCENE_DATA) {
      data = PENDING_SCENE_DATA;
    }

    // 2. Standard assignment
    this.songData = data?.result ? (data as LoadSongPayload) : null;
    this.isDevMode = data?.isDevMode ?? false;
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
    // 0. Initialize audio system.
    this.audioSystem = new AudioSystem(this);

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
      const laneWidth = this.scale.width / LANE_COUNT;

      // 5a. Pre-bake all shared hold-tile canvas textures into the GPU texture cache.
      //     Must run BEFORE buildTileObjects() so textures exist when HoldTileObjects
      //     reference them in their constructors. Safe to call multiple times —
      //     bakeHoldTileTextures() skips any key that already exists in the cache.
      bakeHoldTileTextures(this, laneWidth);

      // 5b. Create the scene-level decoration pool (ring, dots, ripples).
      //     Shared across all hold tiles; tiles borrow on tap and return on release.
      this.holdDecorationPool?.destroy();
      this.holdDecorationPool = new HoldDecorationPool(this, laneWidth);

      // 5c. Instantiate one game object per tile.
      this.buildTileObjects();

      // 5. Build Intro and Start cards
      this.buildStartCards();

      // 6. Build the scroll system that moves the camera each frame.
      this.buildScrollSystem();

      // 7. Build HUD (score + back button).
      const songTitle = this.songData.result.info.name ?? '';
      this.hudSystem = new HUDSystem(
        this,
        this.scale.width,
        this.scale.height,
        MIN_HEIGHT * this.scaleRatio,
        songTitle,
        {
          onToggleMarkers: (active) => this.updateSettings({ showTapMarkers: active }),
          onToggleInteractiveScroll: (active) => this.updateSettings({ interactiveScroll: active }),
          onToggleAutoScroll: (active) => {
            if (active) this.startScroll();
            else this.pauseScroll();
          }
        },
        this.isDevMode
      );

      // Hide arrows / register browse-scroll if game hasn't started.
      if (this.gameStarted) {
        this.cameraScrollSystem?.start();
      }
      this.updateInteractiveScroll(); // Replaces hard registration logic to honor flag

      // --- HARD DIAGNOSTIC CONFIGURATION ---
      // Disable topOnly so scene events fire even if a HUD button is hit.
      this.input.setTopOnly(false);
      
      // Native listeners to see if Browser sees things Phaser doesn't.
      this.onNativeDownBound = () => { this.nativeTapsCount++; };
      window.addEventListener('touchstart', this.onNativeDownBound, { passive: true });
      window.addEventListener('mousedown', this.onNativeDownBound, { passive: true });

      // 8. Build input detection — wires pointer events to tile callbacks.
      //    The callback also starts scroll on the very first tile tap so the
      //    player's first touch kicks off both audio and movement together.
      this.inputSystem = new InputSystem(
        this,
        this.cameras.main,
        () => this.tileObjects,
        (tileObject, worldY) => this.handleTileTap(tileObject, worldY),
        (tileObject) => this.handleTileRelease(tileObject),
        (worldX, worldY) => {
          this.phaserTapsCount++;
          if (this.songData?.showTapMarkers) {
            this.createTapMarker(worldX, worldY);
          }
        },
      );
      this.audioSystem?.loadSongAssets(this.songData.tiles, this.songData.speedMultiplier);
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
    // Update HUD diagnostic text
    // Periodically update diagnostic HUD
    if (this.hudSystem) {
      this.hudSystem.updateDebugInfo(this.nativeTapsCount, this.phaserTapsCount, this.lastHitType);
      this.hudSystem.update(this);
    }

    // Viewport culling: hide tiles that are fully outside the camera's view.
    // This is the #1 performance optimization in any game engine — rendering
    // cost becomes O(visible tiles) instead of O(all tiles).
    // A song like Jingle Bells has 150+ tiles; only 4-8 are ever on screen.
    this.cullTiles();

    // Input is event-driven (no polling needed here).
  }

  // -------------------------------------------------------------------------
  // Viewport culling
  // -------------------------------------------------------------------------

  /**
   * Sets visibility on each tile based on whether it intersects the camera view.
   *
   * WHY this is the correct fix:
   *   Phaser renders EVERY game object in the display list every frame, even invisible
   *   ones that are thousands of pixels above or below the camera. With 150+ tile objects
   *   (each a Container with 1-5 children), this overwhelms low-end Android GPUs.
   *   By calling setVisible(false) on out-of-view tiles, the renderer skips them entirely,
   *   reducing work from O(total tiles) to O(visible tiles) — typically 4-8 at a time.
   *
   * BUFFER:
   *   We use 1 full screen height as a buffer above and below the viewport so tiles
   *   are pre-shown before they scroll into view, preventing a pop-in artifact.
   *
   * PERFORMANCE of this method itself:
   *   O(N) comparisons per frame (N = total tile count, ~150 for Jingle Bells).
   *   Each comparison is tile.y vs two numbers — essentially free on modern CPUs.
   *   The rendering savings (150 tiles → ~6 tiles) far outweigh this loop cost.
   *
   * NOTE: Active hold tiles (isHolding = true) are always kept visible even if
   *   they scroll partially out of frame, so the fill animation never disappears
   *   mid-hold. We achieve this by using a tall buffer below the viewport.
   */
  private cullTiles(): void {
    if (this.tileObjects.length === 0) return;

    const scrollY  = this.cameras.main.scrollY;
    const viewH    = this.scale.height;

    // Buffer = one full screen height above + one full screen height below.
    // This ensures tiles start appearing before they enter frame (no pop-in).
    const buffer   = viewH;
    const viewTop  = scrollY - buffer;
    const viewBot  = scrollY + viewH + buffer;

    for (const tile of this.tileObjects) {
      // Tile occupies world Y range [tile.y, tile.y + tile.tileHeight].
      // Visible if the tile's range intersects [viewTop, viewBot].
      const tileTop = tile.y;
      const tileBot = tile.y + tile.tileHeight;
      const inView  = tileBot > viewTop && tileTop < viewBot;
      tile.setVisible(inView);
    }
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
   * Updates scene settings dynamically (e.g. from the React dev panel).
   * Prevents full scene restarts when only toggling debug flags.
   */
  updateSettings(data: Partial<LoadSongPayload>): void {
    if (!this.songData) return;
    
    if (data.showTapMarkers !== undefined) {
      this.songData.showTapMarkers = data.showTapMarkers;
    }

    if (data.interactiveScroll !== undefined) {
      this.songData.interactiveScroll = data.interactiveScroll;
      this.updateInteractiveScroll();
    }
  }

  /**
   * Enables or disables drag/wheel scroll listeners based on the flag
   * and whether the game has already started.
   */
  private updateInteractiveScroll(): void {
    const isEnabled = this.songData?.interactiveScroll === true;
    
    // The button now controls all manual scrolling.
    if (isEnabled) {
      this.registerBrowseScrollListeners();
    } else {
      this.unregisterBrowseScrollListeners();
    }
  }

  /**
   * Nudges the camera one slot in the given direction.
   * Only used internally; browse-scroll is now driven by drag/wheel.
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

    // The decoration pool must exist before tiles are created so HoldTileObjects
    // can store a reference to it in their constructor.
    const pool = this.holdDecorationPool!;

    this.tileObjects = tiles.map((tile) => {
      const obj = TileObjectFactory.createFor(
        this,
        tile,
        tile.lane * laneWidth,
        tile.top * this.scaleRatio,
        laneWidth,
        tile.height * this.scaleRatio,
        pool,
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
          this.updateInteractiveScroll(); // Will unregister unless flag is on
          this.startScroll();
          startObj.fillColor = 0x888888;
        }
      });
    }

    this.startCardObjects.push(startObj, startLabel);
  }

  // -------------------------------------------------------------------------
  // Browse-scroll: drag + mouse wheel (only before game starts)
  // -------------------------------------------------------------------------

  /**
   * Registers drag and mouse-wheel listeners for pre-game board browsing.
   * Called once when the scene is created (if game hasn't started yet) and
   * again after a resize rebuilds the world.
   */
  private registerBrowseScrollListeners(): void {
    if (this.browseScrollRegistered) return;
    this.browseScrollRegistered = true;

    this.input.on(Phaser.Input.Events.POINTER_DOWN,    this.onBrowseDragStart);
    this.input.on(Phaser.Input.Events.POINTER_MOVE,    this.onBrowseDragMove);
    this.input.on(Phaser.Input.Events.POINTER_UP,      this.onBrowseDragEnd);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onBrowseDragEnd);
    this.input.on(Phaser.Input.Events.POINTER_WHEEL,   this.onBrowseWheel);
  }

  /**
   * Removes drag and mouse-wheel listeners.
   * Called when the START tile is tapped so dragging no longer fights the camera.
   */
  private unregisterBrowseScrollListeners(): void {
    if (!this.browseScrollRegistered) return;
    this.browseScrollRegistered = false;

    this.input.off(Phaser.Input.Events.POINTER_DOWN,    this.onBrowseDragStart);
    this.input.off(Phaser.Input.Events.POINTER_MOVE,    this.onBrowseDragMove);
    this.input.off(Phaser.Input.Events.POINTER_UP,      this.onBrowseDragEnd);
    this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onBrowseDragEnd);
    this.input.off(Phaser.Input.Events.POINTER_WHEEL,   this.onBrowseWheel);
    this.dragStartY = -1;
  }

  private handleBrowseDragStart(p: Phaser.Input.Pointer): void {
    // Rely on updateInteractiveScroll() and register/unregister logic to control when this runs.
    this.dragStartY = p.y;
    this.dragStartScrollY = this.cameras.main.scrollY;
  }

  private handleBrowseDragMove(p: Phaser.Input.Pointer): void {
    if (this.dragStartY < 0) return;
    if (!p.isDown) return;
    const dy = this.dragStartY - p.y; // drag up → dy positive → scroll up
    const maxScrollY = Math.max(0, this.worldHeight - this.scale.height);
    this.cameras.main.scrollY = Math.max(0, Math.min(maxScrollY, this.dragStartScrollY + dy));
  }

  private handleBrowseDragEnd(): void {
    this.dragStartY = -1;
  }

  private handleBrowseWheel(deltaY: number): void {
    const maxScrollY = Math.max(0, this.worldHeight - this.scale.height);
    this.cameras.main.scrollY = Math.max(0, Math.min(maxScrollY, this.cameras.main.scrollY + deltaY * 1.5));
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
  private handleTileTap(tileObject: BaseTileObject, worldY: number): void {
    const result = this.songData?.result;
    const effectiveBpm = result?.info.effectiveBpm ?? result?.info.bpm ?? 120;
    const slotDurationMs = 60000 / effectiveBpm;

    // Visual feedback — greys out single/double tiles; starts the fill tween
    // and schedules beat timers for hold tiles. speedMultiplier scales all timings.
    tileObject.onTap(this.songData?.speedMultiplier ?? 1, worldY, slotDurationMs);

    // Increment HUD score counter.
    this.hudSystem?.increment();

    // Play audio directly in Phaser for zero-latency.
    if (tileObject.getTileType() === 'HOLD') {
      this.audioSystem?.attackHold(tileObject.getGameTile());
    } else {
      this.audioSystem?.playNote(tileObject.getGameTile());
    }
  }

  /**
   * Called by InputSystem when a held pointer is released.
   * Passes through to the tile object; HoldTileObject will cancel its animation.
   * Also emits HOLD_RELEASED so PhaserGameBoard can call useTileAudio.handleHoldRelease().
   */
  private handleTileRelease(tileObject: BaseTileObject): void {
    tileObject.onRelease();
    if (tileObject.getTileType() === 'HOLD') {
      this.audioSystem?.releaseHold(tileObject.getGameTile());
    }
  }

  /**
   * Called by HoldTileObject whenever a secondary beat dot is crossed.
   * Triggers the appropriate instrument samples for synchronized audio.
   */
  public handleHoldBeat(notes: ParsedNote[]): void {
    this.audioSystem?.playHoldBeat(notes);
  }

  /**
   * Spawns a persistent red dot at the given world coordinates.
   * Registered with the display list, so it scrolls with the tiles.
   *
   * @param worldX - X position in Phaser pixels.
   * @param worldY - Y position in Phaser pixels.
   */
  private createTapMarker(worldX: number, worldY: number): void {
    const dot = this.add.circle(worldX, worldY, 8, 0xe74c3c);
    dot.setDepth(5000); // ABOVE HUD (Diagnostic level)
    
    // Log the top object for diagnostic HUD
    const topObj = this.input.manager.hitTest(this.input.activePointer, this.children.list, this.cameras.main)[0];
    this.lastHitType = topObj ? (topObj as any).type || topObj.constructor.name : 'Scene';
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

    // ── Rebuild HUD ─────────────────────────────────────────────────────────
    if (this.hudSystem) {
      this.hudSystem.destroy(this);
      const songTitle = this.songData?.result.info.name ?? '';
      this.hudSystem = new HUDSystem(
        this,
        this.scale.width,
        this.scale.height,
        MIN_HEIGHT * this.scaleRatio,
        songTitle,
        {
          onToggleMarkers: (active) => this.updateSettings({ showTapMarkers: active }),
          onToggleInteractiveScroll: (active) => this.updateSettings({ interactiveScroll: active }),
          onToggleAutoScroll: (active) => {
            if (active) this.startScroll();
            else this.pauseScroll();
          }
        },
        this.isDevMode
      );
    }

    // ── Rebuild input ────────────────────────────────────────────────────────
    // Destroy the old InputSystem so it doesn't fire stale pointer events
    // against tile objects that are about to be recreated.
    this.inputSystem?.destroy();
    this.inputSystem = null;

    // ── Recreate decoration pool at new lane width ───────────────────────────
    // Pool sprites are screen-space objects; destroy and recreate on resize.
    // Textures are NOT recreated — bakeHoldTileTextures() and the cache.exists()
    // guard in each bake function ensures they persist across resize.
    if (this.songData) {
      const laneWidth = this.scale.width / LANE_COUNT;
      bakeHoldTileTextures(this, laneWidth);
      this.holdDecorationPool?.destroy();
      this.holdDecorationPool = new HoldDecorationPool(this, laneWidth);
    }

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
        (tileObject, worldY) => this.handleTileTap(tileObject, worldY),
        (tileObject) => this.handleTileRelease(tileObject),
        (worldX, worldY) => {
          this.phaserTapsCount++;
          if (this.songData?.showTapMarkers) {
            this.createTapMarker(worldX, worldY);
          }
        },
      );
    }
    
    // Ensure scroll listeners are correctly state-synced after rebuild
    this.updateInteractiveScroll();
  }
}
