/**
 * HoldTileObject.ts
 *
 * Phaser game object for a hold tile (spans > 1 slot in height).
 *
 * RESPONSIBILITY:
 *   - Render a tall tile with a body, animated fill-progress bar, and a cap.
 *   - On tap: start a fill animation that rises from the bottom to the top of the
 *     tile over the hold's full duration, matching the CSS HoldTileCard animation.
 *   - On tap: schedule Phaser.Time.TimerEvent beat callbacks for each secondary
 *     beat slot within the hold, so audio fires at the correct musical time.
 *   - On release: stop the fill animation at its current position and cancel
 *     all remaining beat timers.
 *
 * DOES NOT:
 *   - Play audio directly — it emits HOLD_BEAT on the EventBus; PhaserGameBoard
 *     forwards that to useTileAudio.handleHoldBeat().
 *   - Know about camera scroll speed — timing is derived from note durations
 *     and the speedMultiplier passed to onTap().
 *
 * VISUAL STRUCTURE (top-to-bottom in world space):
 *
 *   y=0 ┌──────────────┐  ← tile top (highest world Y — first to scroll into view)
 *       │  BODY        │  Dark navy blue body
 *       │  ░░░░░░░░░░  │  ↑ FILL rect grows upward from cap toward body top
 *       │              │
 *       ├──────────────┤
 *   y=H │  CAP         │  Bright cyan — the tap-zone indicator (visible first,
 *       └──────────────┘  ← tile bottom / first to scroll past the tap line)
 *
 * WHY the fill grows upward:
 *   The world scrolls upward (camera.scrollY decreases). The bottom of the tile
 *   enters the tap zone first. A fill that starts at the cap and grows toward the
 *   tile top mirrors how progress fills "time remaining" as the tile scrolls past.
 *
 * SECONDARY BEATS:
 *   A hold tile's notes[] contains multiple ParsedNote entries at different
 *   slotStart values. Notes at the same slotStart as the primary note (notes[0])
 *   are co-starts — played immediately on tap by useTileAudio. Notes at later
 *   slotStarts are "secondary beats" — they must fire at a musical delay after
 *   the initial tap. HoldTileObject schedules a Phaser.Time.TimerEvent for each
 *   unique secondary slotStart and emits HOLD_BEAT when each timer fires.
 */

import Phaser from 'phaser';
import type { GameTile, ParsedNote } from '../../types/midi';
import { BaseTileObject, TILE_VISUAL_GAP } from './BaseTileObject';
import { EventBus, PianoEvents } from '../EventBus';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Main body color — dark navy blue, matching CSS `#0e3a6e` region. */
const HOLD_BODY_COLOR = 0x0e3a6e;

/** Cap color — bright cyan, matching the original HoldTileCard cap. */
const HOLD_CAP_COLOR = 0x00cfff; // #00cfff — project $accent3

/**
 * Fill progress color — a brighter blue to visually distinguish the "filled"
 * portion from the dark body. Approximates the CSS `#308af1` fill gradient.
 */
const HOLD_FILL_COLOR = 0x308af1;

/**
 * Height of the cap rectangle in pixels.
 * The cap signals the tap-zone and is always visible regardless of tile height.
 * Clamped to 1/4 of tile height for very short hold tiles.
 */
const CAP_HEIGHT = 20;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class HoldTileObject extends BaseTileObject {
  // ── Child game objects ──────────────────────────────────────────────────

  /** Dark blue body rectangle — occupies most of the tile height. */
  private readonly bodyRect: Phaser.GameObjects.Rectangle;

  /**
   * Blue fill progress rectangle — starts at height=0 at the tile bottom,
   * grows upward toward the tile top as the hold duration elapses.
   * Origin is set to (0.5, 1) — bottom-center — so increasing `height`
   * expands upward without changing the bottom anchor position.
   */
  private readonly fillRect: Phaser.GameObjects.Rectangle;

  /** Bright cyan cap at the tile bottom — the first part to reach the tap line. */
  private readonly capRect: Phaser.GameObjects.Rectangle;

  // ── Animation state ─────────────────────────────────────────────────────

  /**
   * The active fill tween (started in onTap(), stopped in onRelease()).
   * Null when no hold is in progress.
   */
  private fillTween: Phaser.Tweens.Tween | null = null;

  /**
   * Active secondary-beat timers. Each fires HOLD_BEAT for one beat slot
   * and is removed from this list when it fires or when onRelease() cancels them.
   */
  private beatTimers: Phaser.Time.TimerEvent[] = [];

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * @param scene      - The owning Phaser scene.
   * @param worldX     - World X of the tile's top-left corner.
   * @param worldY     - World Y of the tile's top-left corner.
   * @param tileWidth  - Full lane width.
   * @param tileHeight - Full tile height in world pixels (spans multiple slots).
   * @param tile       - The source GameTile (tile.notes.length > 1 for hold tiles).
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

    // ── Compute dimensions ─────────────────────────────────────────────────
    const visW = tileWidth - 2 * TILE_VISUAL_GAP;
    const capH = Math.min(CAP_HEIGHT, tileHeight / 4);
    const bodyH = tileHeight - capH - 2 * TILE_VISUAL_GAP;
    const centerX = TILE_VISUAL_GAP + visW / 2;

    // ── Body rectangle ──────────────────────────────────────────────────────
    // Occupies the tile from the top gap down to where the cap begins.
    // Rect (x, y) is its center — so we shift right by half-gap, down by half-bodyH.
    this.bodyRect = scene.add.rectangle(
      centerX,
      TILE_VISUAL_GAP + bodyH / 2,
      visW,
      bodyH,
      HOLD_BODY_COLOR,
    );

    // ── Fill progress rectangle ─────────────────────────────────────────────
    // Initially zero height, anchored at the BOTTOM of the body area.
    // Origin (0.5, 1) means (x, y) positions the BOTTOM CENTER of the rect.
    // As `height` grows from 0 → bodyH, the rect expands upward from the anchor.
    const fillAnchorY = TILE_VISUAL_GAP + bodyH; // bottom of body, top of cap
    this.fillRect = scene.add.rectangle(
      centerX,
      fillAnchorY,
      visW,
      0, // starts invisible (zero height)
      HOLD_FILL_COLOR,
    );
    this.fillRect.setOrigin(0.5, 1);

    // ── Cap rectangle ───────────────────────────────────────────────────────
    // Sits at the tile bottom — the first part the player sees as the tile
    // scrolls upward into the tap zone.
    this.capRect = scene.add.rectangle(
      centerX,
      TILE_VISUAL_GAP + bodyH + capH / 2,
      visW,
      capH,
      HOLD_CAP_COLOR,
    );

    // Add children in back-to-front render order:
    //   body (behind fill) → fill (behind cap) → cap (on top, always visible)
    this.add([this.bodyRect, this.fillRect, this.capRect]);
  }

  // ---------------------------------------------------------------------------
  // BaseTileObject implementation
  // ---------------------------------------------------------------------------

  getTileType(): 'HOLD' {
    return 'HOLD';
  }

  /**
   * Starts the hold animation and schedules secondary beat timers.
   *
   * Called by InputSystem → PianoGameScene.handleTileTap() on finger-down.
   * Returns immediately if already tapped (guards against double-fire).
   *
   * @param speedMultiplier - Current playback speed multiplier (default 1).
   *   Scales both the fill-tween duration and beat-timer delays proportionally.
   */
  onTap(speedMultiplier = 1): void {
    if (this.tapped) return;
    this.tapped = true;

    const primaryNote = this.gameTile.notes[0];
    if (!primaryNote) return;

    // ── Fill tween ────────────────────────────────────────────────────────
    // Rise from height 0 to full body height over the hold's note duration,
    // adjusted for playback speed. Linear easing matches the constant scroll speed.
    const capH = Math.min(CAP_HEIGHT, this.tileHeight / 4);
    const fillMaxH = this.tileHeight - capH - 2 * TILE_VISUAL_GAP;
    const durationMs = (primaryNote.duration / speedMultiplier) * 1000;

    this.fillTween = this.scene.tweens.add({
      targets: this.fillRect,
      // Tween the Rectangle's `height` property directly.
      // With origin (0.5, 1) this makes the rect grow upward from its anchor.
      height: fillMaxH,
      duration: durationMs,
      ease: 'Linear',
    });

    // ── Secondary beat timers ──────────────────────────────────────────────
    this.scheduleBeatTimers(primaryNote, speedMultiplier);
  }

  /**
   * Stops the fill animation at its current state and cancels all remaining
   * beat timers. Called by InputSystem → PianoGameScene.handleTileRelease()
   * on finger-up / finger-cancel.
   *
   * WHY stop instead of reset:
   *   The player may release mid-hold. The fill should freeze at its current
   *   height (showing how far they got), not snap back to zero. This also
   *   matches the CSS HoldTileCard behavior (commitStyles + cancel).
   */
  onRelease(): void {
    if (!this.tapped) return;

    // Stop the tween at its current position (does not reset the height property).
    this.fillTween?.stop();
    this.fillTween = null;

    // Cancel all pending beat timers so no audio fires after release.
    this.beatTimers.forEach((t) => t.remove(false));
    this.beatTimers = [];

    // Grey out all Rectangle children (body, fill, cap) to signal completion.
    this.markTapped();
  }

  // ---------------------------------------------------------------------------
  // Private: beat scheduling
  // ---------------------------------------------------------------------------

  /**
   * Groups the tile's notes by slotStart, then schedules a Phaser timer for
   * each unique secondary beat (i.e. every slotStart that differs from the
   * primary note's slotStart).
   *
   * When each timer fires it emits HOLD_BEAT on the EventBus with the
   * notes for that beat. PhaserGameBoard listens and calls useTileAudio.handleHoldBeat().
   *
   * WHY group by slotStart:
   *   A hold tile can have multiple notes at the same secondary slotStart
   *   (e.g. a chord on beat 2). They must all fire together, not separately.
   *
   * @param primaryNote     - The first note; defines t=0 for delay calculation.
   * @param speedMultiplier - Scales all delays so fast/slow speeds are respected.
   */
  private scheduleBeatTimers(primaryNote: ParsedNote, speedMultiplier: number): void {
    // Build a map of slotStart → { time, notes[] } for all non-primary beats.
    const groups = new Map<number, { time: number; notes: ParsedNote[] }>();

    for (const note of this.gameTile.notes) {
      // Skip notes that co-start with the primary — those are played immediately
      // by useTileAudio.handleTileTap() (the "co-starts" branch).
      if (note.slotStart === primaryNote.slotStart) continue;

      if (!groups.has(note.slotStart)) {
        groups.set(note.slotStart, { time: note.time, notes: [] });
      }
      groups.get(note.slotStart)!.notes.push(note);
    }

    // Sort beats chronologically and schedule one timer per beat slot.
    const sortedBeats = Array.from(groups.values()).sort((a, b) => a.time - b.time);

    for (const beat of sortedBeats) {
      // Delay = time between primary note start and this beat's start,
      // divided by speedMultiplier so faster play fires sooner.
      const delayMs = ((beat.time - primaryNote.time) / speedMultiplier) * 1000;

      if (delayMs <= 0) {
        // Should not happen (secondary beats are always after the primary),
        // but guard against floating-point edge cases.
        continue;
      }

      // Capture notes in a stable closure variable so the timer callback
      // always references the correct beat's notes regardless of loop iteration.
      const beatNotes = beat.notes.slice();

      const timer = this.scene.time.addEvent({
        delay: delayMs,
        callback: () => {
          // Emit the beat with its notes so PhaserGameBoard can call
          // useTileAudio.handleHoldBeat(notes).
          EventBus.emit(PianoEvents.HOLD_BEAT, {
            tile: this.gameTile,
            notes: beatNotes,
          });
        },
      });

      this.beatTimers.push(timer);
    }
  }
}
