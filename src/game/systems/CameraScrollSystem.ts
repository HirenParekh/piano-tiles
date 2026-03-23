/**
 * CameraScrollSystem.ts
 *
 * Drives the Phaser camera upward through the tile world at the musical tempo.
 *
 * RESPONSIBILITY:
 *   Own the camera's scrollY each frame. That is its only job.
 *   - `start()` / `pause()` / `resume()` control playback state.
 *   - `setSpeed(multiplier)` adjusts the speed live (e.g. when the user
 *     drags the speed slider mid-song).
 *   - `update(delta)` is called once per frame by PianoGameScene.update().
 *
 * DOES NOT:
 *   - Know about tiles, input, audio, or scoring.
 *   - Know about React or the EventBus.
 *   - Compute scroll-segment boundaries (delegated to ScrollSegmentTracker).
 *
 * HOW IT WORKS:
 *   The world is laid out top-to-bottom in Phaser:
 *     worldY = 0            → end of song (top)
 *     worldY = worldHeight  → start of song (bottom)
 *
 *   The camera starts at scrollY = startScrollY (= worldHeight - gameHeight),
 *   showing the song's beginning at the bottom of the viewport. Each frame,
 *   scrollY decreases by (pixelsPerSecond × speedMultiplier × deltaSeconds),
 *   moving the viewport upward through the world.
 *
 *   When scrollY reaches 0 (or below), the song has finished scrolling.
 *
 * SPEED FORMULA (from useGameBoardEngine — kept identical for parity):
 *   pixelsPerSecond = (MIN_HEIGHT / slotDurationS) * scaleRatio
 *
 *   For variable-BPM songs, slotDurationS varies per segment; ScrollSegmentTracker
 *   returns the correct value for the current playback position.
 *
 * SONG DISTANCE:
 *   songDistancePx = startScrollY - camera.scrollY
 *   Represents how many world pixels the camera has traveled since the song started.
 *   Used by ScrollSegmentTracker to select the active segment.
 */

import type Phaser from 'phaser';
import type { ScrollSegmentTracker } from './ScrollSegmentTracker';

export class CameraScrollSystem {
  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /** The Phaser main camera — we mutate its scrollY each frame. */
  private readonly camera: Phaser.Cameras.Scene2D.Camera;

  /** Supplies pixelsPerSecond for the current song position. */
  private readonly tracker: ScrollSegmentTracker;

  /**
   * The camera's scrollY at song start (= worldHeight - gameHeight).
   * Stored so we can compute songDistancePx = startScrollY - camera.scrollY.
   */
  private readonly startScrollY: number;

  /** Current viewport scale ratio (gameHeight / (VISIBLE_SLOTS * MIN_HEIGHT)). */
  private scaleRatio: number;

  /** Playback speed multiplier. 1.0 = normal, 0.5 = half speed. */
  private speedMultiplier: number;

  /** True while the camera is actively scrolling. */
  private playing = false;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * @param camera          - The scene's main camera (this.cameras.main).
   * @param tracker         - Provides pixelsPerSecond for the current position.
   * @param startScrollY    - Camera scrollY at the beginning of the song
   *                          (= worldHeight - gameHeight; computed in PianoGameScene).
   * @param scaleRatio      - Current scale ratio; update via setScaleRatio() on resize.
   * @param speedMultiplier - Initial playback speed (1.0 for normal speed).
   */
  constructor(
    camera: Phaser.Cameras.Scene2D.Camera,
    tracker: ScrollSegmentTracker,
    startScrollY: number,
    scaleRatio: number,
    speedMultiplier: number,
  ) {
    this.camera = camera;
    this.tracker = tracker;
    this.startScrollY = startScrollY;
    this.scaleRatio = scaleRatio;
    this.speedMultiplier = speedMultiplier;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Begins camera scroll from the current position.
   * Safe to call multiple times — subsequent calls are no-ops if already playing.
   */
  start(): void {
    this.playing = true;
  }

  /**
   * Pauses camera scroll without resetting position.
   * Resume with `resume()` to continue from where it stopped.
   */
  pause(): void {
    this.playing = false;
  }

  /**
   * Resumes a paused scroll. Identical to start() in this implementation;
   * kept separate so call sites communicate their intent clearly.
   */
  resume(): void {
    this.playing = true;
  }

  /**
   * Returns true while scrolling is active.
   */
  isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Live speed adjustment — effective immediately on the next frame.
   *
   * WHY not re-create the system: unlike WAAPI (which bakes speed into keyframe
   * timing), we multiply speed into the per-frame delta. Changing the multiplier
   * takes effect on the very next update() call with zero setup cost.
   *
   * @param multiplier - New speed multiplier (e.g. 0.5 for half speed).
   */
  setSpeed(multiplier: number): void {
    this.speedMultiplier = multiplier;
  }

  /**
   * Updates the stored scale ratio after a viewport resize.
   * ScrollSegmentTracker uses the ratio on every lookup, so no rebuild is needed there.
   *
   * @param scaleRatio - New ratio from PianoGameScene after Phaser.Scale.RESIZE.
   */
  setScaleRatio(scaleRatio: number): void {
    this.scaleRatio = scaleRatio;
  }

  /**
   * Nudges the camera by one slot in the given direction.
   * Only active while the song is NOT playing — prevents audio/visual desync.
   * Used by the HUD arrow buttons to let the player browse tiles before starting.
   *
   * @param direction - 'up' moves toward the song end; 'down' toward the start.
   * @param slotPx    - One slot in world pixels (MIN_HEIGHT * scaleRatio).
   */
  nudge(direction: 'up' | 'down', slotPx: number): void {
    if (this.playing) return;
    if (direction === 'up') {
      this.camera.scrollY = Math.max(0, this.camera.scrollY - slotPx);
    } else {
      this.camera.scrollY = Math.min(this.startScrollY, this.camera.scrollY + slotPx);
    }
  }

  /**
   * Per-frame camera update. Must be called from PianoGameScene.update().
   *
   * @param delta - Milliseconds elapsed since the last frame (from Phaser's game loop).
   *                Using delta-time (not a fixed step) keeps scroll speed correct
   *                at any frame rate and when the tab is backgrounded/foregrounded.
   */
  update(delta: number): void {
    if (!this.playing) return;

    // Convert delta from milliseconds to seconds for the speed formula.
    const deltaSeconds = delta / 1000;

    // How far has the camera already traveled? Used to select the active segment.
    const songDistancePx = this.startScrollY - this.camera.scrollY;

    // Ask the tracker for the correct speed at this position in the song.
    const pixelsPerSecond = this.tracker.getPixelsPerSecond(
      songDistancePx,
      this.scaleRatio,
    );

    // Move the camera upward (decreasing scrollY) by the scaled amount.
    const scrollDelta = pixelsPerSecond * this.speedMultiplier * deltaSeconds;
    this.camera.scrollY -= scrollDelta;

    // Stop at the top of the world (scrollY = 0 = end of song).
    // Phaser's setBounds() also clamps this, but we guard here for clarity.
    if (this.camera.scrollY <= 0) {
      this.camera.scrollY = 0;
      this.playing = false;
    }
  }
}
