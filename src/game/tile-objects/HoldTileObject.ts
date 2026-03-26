/**
 * HoldTileObject.ts
 *
 * Phaser game object for a hold tile (spans > 1 slot in height).
 *
 * PHASE 2 ANIMATIONS IMPLEMENTED:
 *   - Dark-to-Navy gradient body via 4-color Rectangle fill.
 *   - Bright neon laser line down the center (`BlendModes.ADD`).
 *   - Tap ring burst animation at the bottom tap area.
 *   - Dynamic fill geometry (rectangle + rounded dome) via Phaser Graphics.
 *   - White glowing leader dot that travels ahead of the fill.
 *   - Secondary beat dots that erupt into sonar-like rings as the fill crosses them.
 */

import Phaser from 'phaser';
import type { GameTile, ParsedNote } from '../../types/midi';
import { BaseTileObject, TILE_VISUAL_GAP } from './BaseTileObject';
import { EventBus, PianoEvents } from '../EventBus';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOLD_BODY_TOP = 0x1565c0;
const HOLD_BODY_BOT = 0x000000;
const HOLD_CAP_COLOR = 0x00cfff;
const HOLD_FILL_COLOR = 0x308af1;
const LASER_TOP = 0x64c8ff;
const LASER_BOT = 0x00c8ff;
const DOT_COLOR = 0x00d2ff;

const CAP_HEIGHT = 20;

// The follower dot sits exactly 50px vertically above the apex of the fill dome
// so it remains visible above the player's thumb.
const DOT_OFFSET_PX = 50;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class HoldTileObject extends BaseTileObject {
  // ── Child game objects ──────────────────────────────────────────────────

  private readonly bgGraphics: Phaser.GameObjects.Graphics;
  private readonly laserGraphics: Phaser.GameObjects.Graphics;
  private readonly capRect: Phaser.GameObjects.Rectangle;

  /** Dynamic Graphics object drawing the fill body + rounded dome head */
  private readonly fillGraphics: Phaser.GameObjects.Graphics;

  /** The ring at the bottom that bursts outward on tap */
  private readonly bottomRing: Phaser.GameObjects.Arc;

  /** The container holding the moving dot, glow, and any ripples that erupt */
  private readonly followerGroup: Phaser.GameObjects.Container;
  private readonly followerDot: Phaser.GameObjects.Arc;
  private readonly followerGlow: Phaser.GameObjects.Arc;

  // ── Animation state ─────────────────────────────────────────────────────

  private lastApexY: number | undefined;
  private staticBeatDots: { arc: Phaser.GameObjects.Arc; timeOffsetMs: number; notes: ParsedNote[] }[] = [];
  private firedDots = new Set<number>();

  // Tween target representing the pixel height of the fill progress
  private fillState = { height: 0 };

  // The bottom-center Y coordinate where the fill and cap anchor
  private readonly fillAnchorY: number;

  private isHolding = false;
  private tapScreenY = 0;
  private fillMaxH = 0;
  private speedMultiplier = 1;

  constructor(
    scene: Phaser.Scene,
    worldX: number,
    worldY: number,
    tileWidth: number,
    tileHeight: number,
    tile: GameTile,
  ) {
    super(scene, worldX, worldY, tileWidth, tileHeight, tile);

    const visW = tileWidth - 2 * TILE_VISUAL_GAP;
    const capH = Math.min(CAP_HEIGHT, tileHeight / 4);
    const bodyH = tileHeight - capH - 2 * TILE_VISUAL_GAP;
    const centerX = TILE_VISUAL_GAP + visW / 2;
    this.fillAnchorY = TILE_VISUAL_GAP + bodyH;

    // ── Body & Laser Graphics ─────────────────────────────────────────────
    // Replaces generic Rectangles so we can use complex 4-corner gradients
    this.bgGraphics = scene.add.graphics();
    this.bgGraphics.fillGradientStyle(HOLD_BODY_TOP, HOLD_BODY_TOP, HOLD_BODY_BOT, HOLD_BODY_BOT, 1, 1, 1, 1);
    this.bgGraphics.fillRect(TILE_VISUAL_GAP, TILE_VISUAL_GAP, visW, bodyH);

    // 2px wide line in the center, stops slightly short of the bottom
    // Fades alpha from 0.65 at top to 0 at bottom
    this.laserGraphics = scene.add.graphics();
    const laserX = TILE_VISUAL_GAP + visW / 2 - 1;
    this.laserGraphics.fillGradientStyle(LASER_TOP, LASER_TOP, LASER_BOT, LASER_BOT, 0.8, 0.8, 0, 0);
    this.laserGraphics.fillRect(laserX, TILE_VISUAL_GAP, 2, Math.max(0, bodyH - 30));
    this.laserGraphics.setBlendMode(Phaser.BlendModes.ADD);

    // ── Fill Graphics ─────────────────────────────────────────────────────
    this.fillGraphics = scene.add.graphics();

    // ── Cap Rectangle ─────────────────────────────────────────────────────
    this.capRect = scene.add.rectangle(centerX, this.fillAnchorY + capH / 2, visW, capH, HOLD_CAP_COLOR);

    // ── Tap Ring ──────────────────────────────────────────────────────────
    // Matches "__hold-ring" positioned at the bottom of the body
    this.bottomRing = scene.add.arc(centerX, this.fillAnchorY - 12, 12);
    this.bottomRing.setStrokeStyle(2, HOLD_CAP_COLOR, 0.85);

    // ── Follower Group ────────────────────────────────────────────────────
    // Grouped together so the visual dot and any ripples physically move 
    // up the tile in perfect unison just like the CSS implementation.
    this.followerGroup = scene.add.container(centerX, this.fillAnchorY);
    this.followerGroup.setAlpha(0); // Hidden until tapped

    // A subtle glowing backdrop simulating the old CSS drop-shadow filter
    this.followerGlow = scene.add.circle(0, 0, 14, LASER_TOP, 0.4);
    this.followerGlow.setBlendMode(Phaser.BlendModes.ADD);

    this.followerDot = scene.add.arc(0, 0, 7, 0, 360, false, 0xffffff);

    this.followerGroup.add([this.followerGlow, this.followerDot]);

    // Back-to-front rendering
    this.add([
      this.bgGraphics,
      this.laserGraphics,
      this.bottomRing,
      this.fillGraphics,
      this.capRect,
      this.followerGroup
    ]);

    // ── Secondary Beat Static Dots ────────────────────────────────────────
    const defaultTapOffset = capH / 2;
    this.buildStaticBeatDots(centerX, defaultTapOffset);
  }

  // ---------------------------------------------------------------------------
  // Implementations
  // ---------------------------------------------------------------------------

  getTileType(): 'HOLD' {
    return 'HOLD';
  }

  onTap(speedMultiplier = 1, worldY?: number, _slotDurationMs = 0): void {
    if (this.tapped) return;
    this.tapped = true;
    this.speedMultiplier = speedMultiplier;

    const primaryNote = this.gameTile.notes[0];
    if (!primaryNote) return;

    let tapDistFromBottom = 0;
    if (worldY !== undefined) {
      this.tapScreenY = worldY - this.scene.cameras.main.scrollY;
      tapDistFromBottom = (this.y + this.tileHeight) - worldY;
    } else {
      this.tapScreenY = (this.y + this.tileHeight) - this.scene.cameras.main.scrollY;
    }
    tapDistFromBottom = Math.max(0, Math.min(this.tileHeight, tapDistFromBottom));

    const capH = Math.min(CAP_HEIGHT, this.tileHeight / 4);

    // Geometry math to ensure the APEX of the arc is positioned exactly DOT_OFFSET_PX above the physical tap:
    const visW = this.tileWidth - 2 * TILE_VISUAL_GAP;
    const dy = visW * 0.866025; // sqrt(3)/2

    // Using simple math to anchor the apex:
    let initialFillH = Math.max(0, tapDistFromBottom + DOT_OFFSET_PX - capH + dy - visW);
    this.fillMaxH = this.tileHeight - capH - 2 * TILE_VISUAL_GAP;

    this.fillState.height = initialFillH;
    this.drawFillFrame();

    // ── Tap Ring Burst Animation ──────────────────────────────────────────
    this.scene.tweens.add({
      targets: this.bottomRing,
      scale: 1.4,
      alpha: 0,
      duration: 300 / this.speedMultiplier,
      ease: 'Cubic.out',
      onStart: () => {
        this.bottomRing.setStrokeStyle(3, 0xffffff, 1);
      }
    });

    // ── Reveal Follower Group  ──────────────────────────────
    this.followerGroup.setAlpha(1);

    // Animate static dots in when tapped
    this.scene.tweens.add({
      targets: this.staticBeatDots.map(d => d.arc),
      alpha: 1, // Start fully opaque
      duration: 100 / this.speedMultiplier,
    });
    this.updateStaticBeatDotsLayout(tapDistFromBottom);

    this.firedDots.clear();
    this.lastApexY = undefined;
    this.isHolding = true;

    this.scene.events.off('update', this.onPhysicsUpdate, this);
    this.scene.events.on('update', this.onPhysicsUpdate, this);
  }

  onRelease(): void {
    if (!this.tapped) return;

    this.isHolding = false;
    this.scene.events.off('update', this.onPhysicsUpdate, this);
    this.lastApexY = undefined;
    this.firedDots.clear();

    // Flatten dome at release to signal completion
    this.drawFillFrame(true);

    this.markTapped();
    
    // Hide dots and glow
    this.followerGroup.setAlpha(0);
  }

  // ---------------------------------------------------------------------------
  // Geometry & Rendering
  // ---------------------------------------------------------------------------

  private onPhysicsUpdate(_time: number, _delta: number): void {
    if (!this.isHolding) return;

    const currentWorldY = this.tapScreenY + this.scene.cameras.main.scrollY;
    let tapDistFromBottom = (this.y + this.tileHeight) - currentWorldY;
    tapDistFromBottom = Math.max(0, Math.min(this.tileHeight, tapDistFromBottom));

    const capH = Math.min(CAP_HEIGHT, this.tileHeight / 4);
    const visW = this.tileWidth - 2 * TILE_VISUAL_GAP;
    const dy = visW * 0.866025; // sqrt(3)/2

    let newHeight = Math.max(0, tapDistFromBottom + DOT_OFFSET_PX - capH + dy - visW);
    newHeight = Math.min(newHeight, this.fillMaxH);
    
    this.fillState.height = newHeight;

    // ── Spatial Collision Detection ──────────────────────────────────────────
    const currentApexY = this.tileHeight - TILE_VISUAL_GAP - tapDistFromBottom - DOT_OFFSET_PX;
    if (this.lastApexY !== undefined) {
      for (let i = 0; i < this.staticBeatDots.length; i++) {
        if (this.firedDots.has(i)) continue;
        const dot = this.staticBeatDots[i];
        
        // Detect crossing (Apex moves UP = decreasing Y): current <= dotY < last
        if (currentApexY <= dot.arc.y && dot.arc.y < this.lastApexY) {
          this.firedDots.add(i);
          this.fireBeat(dot.notes, dot.arc);
        }
      }
    }
    this.lastApexY = currentApexY;

    this.drawFillFrame();

    if (newHeight >= this.fillMaxH) {
      this.isHolding = false;
      this.scene.events.off('update', this.onPhysicsUpdate, this);
      this.drawFillFrame(true);
    }
  }

  /**
   * Clears and redraws the fill geometry (body rect + dome top).
   * Repositions the follower dot based on the apex of the dome.
   * 
   * @param forceFlat - if true, draws a flat top instead of a dome (used on release)
   */
  private drawFillFrame(forceFlat = false): void {
    this.fillGraphics.clear();
    const h = this.fillState.height;
    if (h <= 0 && !forceFlat) return;

    const visW = this.tileWidth - 2 * TILE_VISUAL_GAP;
    const leftX = TILE_VISUAL_GAP;
    const rightX = TILE_VISUAL_GAP + visW;

    // The visual top line where the dome starts
    const topY = this.fillAnchorY - h;

    this.fillGraphics.fillStyle(HOLD_FILL_COLOR);
    this.fillGraphics.beginPath();
    this.fillGraphics.moveTo(leftX, this.fillAnchorY); // Bottom-left
    this.fillGraphics.lineTo(rightX, this.fillAnchorY); // Bottom-right
    this.fillGraphics.lineTo(rightX, topY); // Top-right

    // If flat (tile completed or released), just draw a straight line.
    // Otherwise, draw the circular arc dome.
    if (forceFlat) {
      this.fillGraphics.lineTo(leftX, topY);
      this.followerGroup.setY(topY);
    } else {
      // ── Perfect geometric dome matching the CSS `width: 200%, aspect-ratio: 1` ──
      // The CSS dome was a circle of radius W, clipped to width W.
      // This means the center is precisely W * sqrt(3)/2 pixels below the chord.
      // The angle from the center to the corners is exactly +/- 60 degrees from vertical.
      const R = visW;
      const dy = visW * 0.866025; // sqrt(3)/2
      const cx = leftX + visW / 2;
      const cy = topY + dy;

      this.fillGraphics.arc(
        cx,
        cy,
        R,
        Phaser.Math.DegToRad(-60),
        Phaser.Math.DegToRad(-120),
        true // anticlockwise (from top-right to top-left)
      );

      // The apex (highest point) of the arc is exactly at -90 degrees from center
      const apexY = cy - R;

      // The follower group sits directly ON the apex!
      this.followerGroup.setY(Math.max(TILE_VISUAL_GAP, apexY));
    }

    this.fillGraphics.closePath();
    this.fillGraphics.fillPath();
  }

  // ---------------------------------------------------------------------------
  // Beat Scheduling & Ripple
  // ---------------------------------------------------------------------------

  private buildStaticBeatDots(centerX: number, defaultTapOffset: number): void {
    const primaryNote = this.gameTile.notes[0];
    const grouped = new Map<number, ParsedNote[]>();

    for (const note of this.gameTile.notes) {
      if (note.time !== primaryNote.time) {
        if (!grouped.has(note.time)) {
          grouped.set(note.time, []);
        }
        grouped.get(note.time)!.push(note);
      }
    }

    const slotSpanMultiplier = Math.max(1, Math.round(this.gameTile.slotSpan));
    const singleTileH = this.tileHeight / slotSpanMultiplier;
    const visualBottomY = this.tileHeight - TILE_VISUAL_GAP;

    const times = Array.from(grouped.keys()).sort((a,b) => a - b);
    for (const time of times) {
      const notes = grouped.get(time)!;
      const slotOffset = notes[0].slotStart - primaryNote.slotStart;

      // The dot is exactly spatialOffset + DOT_OFFSET_PX from its base musical position
      const dotPxFromBottom = defaultTapOffset + (slotOffset * singleTileH) + DOT_OFFSET_PX;
      const dotY = visualBottomY - dotPxFromBottom;

      // Start with object alpha=0, but fillAlpha=1 so the color is fully present when revealed
      const staticDot = this.scene.add.circle(centerX, dotY, 4, DOT_COLOR, 1);
      staticDot.setAlpha(0);

      this.add(staticDot);

      this.staticBeatDots.push({ arc: staticDot, timeOffsetMs: (time - primaryNote.time) * 1000, notes });
    }
  }

  private updateStaticBeatDotsLayout(tapDistFromBottom: number): void {
    const primaryNote = this.gameTile.notes[0];
    const slotSpanMultiplier = Math.max(1, Math.round(this.gameTile.slotSpan));
    const singleTileH = this.tileHeight / slotSpanMultiplier;
    const visualBottomY = this.tileHeight - TILE_VISUAL_GAP;

    for (const dot of this.staticBeatDots) {
      const slotOffset = dot.notes[0].slotStart - primaryNote.slotStart;
      const dotPxFromBottom = tapDistFromBottom + (slotOffset * singleTileH) + DOT_OFFSET_PX;
      const dotY = visualBottomY - dotPxFromBottom;
      dot.arc.setY(dotY);
    }
  }

  private fireBeat(notes: ParsedNote[], staticDotElem: Phaser.GameObjects.Arc): void {
    EventBus.emit(PianoEvents.HOLD_BEAT, {
      tile: this.gameTile,
      notes: notes,
    });

    staticDotElem.setAlpha(0);

    const ripple = this.scene.add.circle(0, 0, 7);
    ripple.isFilled = false;
    ripple.setStrokeStyle(2, 0xa0e1ff, 0.9);

    this.followerGroup.add(ripple);

    this.scene.tweens.add({
      targets: ripple,
      scale: 6,
      alpha: 0,
      duration: 180,
      ease: 'Quad.out',
      onComplete: () => {
        ripple.destroy();
      }
    });

    this.scene.tweens.add({
      targets: this.followerDot,
      alpha: 0.2,
      duration: 180 / this.speedMultiplier,
      yoyo: true,
      ease: 'Sine.inOut'
    });
  }
}
