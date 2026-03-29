/**
 * HoldTileObject.ts
 *
 * Phaser game object for a hold tile (spans > 1 slot in height).
 *
 * PERFORMANCE DESIGN — 3 game objects per tile (down from 12–15):
 *   1. bodySprite  — Image using shared 'hold-body-{W}' canvas texture (scaleY to height)
 *   2. fillRect    — Rectangle (solid blue, scaleY animated per frame during hold)
 *   3. domeSprite  — Image using shared 'hold-dome-{W}' canvas texture (setY per frame)
 *
 *   All three share textures with every other hold tile → ONE draw call batch for all.
 *   Per-frame hot path: two property writes (scaleY + setY). Zero GPU geometry uploads.
 *
 * DECORATION (ring burst, laser, beat dots, ripples):
 *   Managed by HoldDecorationPool (scene-level, shared across all tiles).
 *   This tile owns ZERO decoration objects at rest — it borrows from the pool on tap
 *   and returns them on release/tween-complete.
 *   Pool total: ~18 objects for ALL tiles combined, vs. ~240 in the old per-tile approach.
 *
 * GEOMETRY CONSTANTS:
 *   All layout values (visW, capH, bodyH, domeDy, etc.) are pre-computed as
 *   private readonly fields — the per-frame update loop reads them, never derives them.
 */

import Phaser from 'phaser';
import type { GameTile, ParsedNote } from '../../types/midi';
import { BaseTileObject, TILE_VISUAL_GAP } from './BaseTileObject';
import { holdTextureKey } from './HoldTileTextures';
import type { HoldDecorationPool, PooledDot } from './HoldDecorationPool';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------


/**
 * The follower dot (dome apex indicator) sits this many pixels above the tap point.
 * Keeps it visible above the player's thumb.
 */
const DOT_OFFSET_PX = 50;

/** Phaser hex color for the fill rectangle */
const HOLD_FILL_COLOR = 0x308af1;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class HoldTileObject extends BaseTileObject {

  // ── Pre-computed geometry (computed once in constructor, read every frame) ──
  private readonly visW: number;
  /** Bottom cap height (capped at tileHeight / 4) */
  private readonly capH: number;
  /** Main body height = tileHeight − capH − 2 × TILE_VISUAL_GAP */
  private readonly bodyH: number;
  /** Horizontal center of the tile in local container coordinates */
  private readonly centerX: number;
  /** Y where the fill anchors at its bottom (body meets cap) — local coords */
  private readonly fillAnchorY: number;
  /** Maximum fill height = bodyH */
  private readonly fillMaxH: number;
  /** Distance from chord line DOWN to the dome’s circle center = visW × sin(60°) */
  private readonly domeDy: number;
  /** Pixel height the dome protrudes above the chord ≈ visW × 0.134 */
  private readonly domeHeight: number;
  /**
   * Total height of the dome canvas texture = ceil(domeHeight) + 2px top buffer.
   * Must match what HoldTileTextures.bakeDome() produces.
   */
  private readonly domeRTH: number;

  /**
   * Represents the upper portion of the hold tile (from the top down to 1 slot from the bottom).
   * Image sprite using the shared 'body-top' gradient texture (#1565c0 to #0e3a6e).
   */
  private readonly bodyTopSprite: Phaser.GameObjects.Image;

  /**
   * Represents the bottom single-slot portion of the hold tile.
   * Image sprite using the shared 'body-base' texture (#0e3a6e to solid black).
   * Positioned at the absolute bottom of the hold tile, scaled exactly to 1 singleTileH.
   */
  private readonly bodyBaseSprite: Phaser.GameObjects.Image;

  /**
   * Laser glow strip. Image sprite using shared 'hold-laser-{W}' texture.
   * ADD blend mode; scaleY set once to match bodyH.
   * Static — never changes per frame.
   */
  private readonly laserSprite: Phaser.GameObjects.Image;

  /**
   * Fill progress bar. Rectangle with scaleY driven each frame during a hold.
   * Origin (0.5, 1) so it grows upward from fillAnchorY.
   * PERFORMANCE: changing scaleY = one property write per frame, batched with all sprites.
   */
  private readonly fillRect: Phaser.GameObjects.Rectangle;

  /**
   * Dome cap sprite using shared 'hold-dome-{W}' canvas texture.
   * Hidden until the hold starts; repositioned via setY() each frame.
   * Origin (0, 0) so x/y refers to the top-left corner (math is straightforward).
   */
  private readonly domeSprite: Phaser.GameObjects.Image;

  /**
   * Static tap-target ring at the tile's bottom.
   * Uses the shared 'hold-tapring-{W}' canvas texture — baked once, purely static.
   * Visible only before tap; hidden immediately when the player touches.
   */
  private readonly tapRingSprite: Phaser.GameObjects.Image;

  // ── Scene-level decoration pool (borrowed on tap, returned on release) ─

  /**
   * Reference to the scene-level HoldDecorationPool.
   * This tile does NOT own any decoration objects — it borrows from the pool
   * when tapped and returns them when released or when tween completes.
   */
  private readonly decorPool: HoldDecorationPool;


  /**
   * Borrowed dot sprites for secondary beat positions.
   * Each entry corresponds to one staticBeatDots entry.
   * Null slots mean that dot hasn't been borrowed yet (dots are borrowed on tap,
   * before which they are not visible).
   */
  private activeDots: (PooledDot | null)[] = [];

  /**
   * List of spawned visual effects (ripples, apex dots) that are currently active.
   * Their world Y-coordinates will be continuously updated to mathematically 
   * "ride" the apex of the dome as the progress bar moves up!
   */
  /**
   * List of spawned visual effects (ripples, apex dots) that are currently active.
   * Their world Y-coordinates will be continuously updated to mathematically 
   * "ride" the apex of the dome as the progress bar moves up!
   */
  private activeTrackingDecorations: Phaser.GameObjects.Image[] = [];

  // ── Secondary beat detection state ──────────────────────────────────────

  /**
   * One descriptor per unique time offset in this hold tile's notes.
   * Built once at construction; the worldY of each dot is tracked for crossing.
   */
  private staticBeatDots: { worldY: number; timeOffsetMs: number; notes: ParsedNote[] }[] = [];

  /**
   * Set of dot indices that have already fired beats in this hold.
   * Prevents re-firing on subsequent frames.
   */
  private firedDots = new Set<number>();

  // ── Physics state ────────────────────────────────────────────────────────

  /**
   * Last known apex Y in local container coordinates.
   * Used for beat crossing detection (compared each frame to dot worldY values).
   */
  private lastApexY: number | undefined;

  /**
   * Current fill height in pixels (0 = empty, fillMaxH = full).
   * Updated every frame during a hold.
   */
  private fillHeight = 0;

  /** True while the player's finger is pressing this tile */
  private isHolding = false;

  /**
   * Screen-space Y captured at tap time = worldY − camera.scrollY.
   * Re-adds current scrollY each frame to reconstruct the tap's world position.
   */
  private tapScreenY = 0;

  /** Playback speed multiplier (1 = normal). Scales tween durations. */
  private speedMultiplier = 1;

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(
    scene: Phaser.Scene,
    worldX: number,
    worldY: number,
    tileWidth: number,
    tileHeight: number,
    tile: GameTile,
    decorPool: HoldDecorationPool,
  ) {
    super(scene, worldX, worldY, tileWidth, tileHeight, tile);
    this.decorPool = decorPool;

    // ── Pre-compute all geometry constants ─────────────────────────────────
    this.visW        = tileWidth - 2 * TILE_VISUAL_GAP;
    this.capH        = 0; // Hold tiles do not use bottom caps
    this.bodyH       = tileHeight - this.capH - 2 * TILE_VISUAL_GAP;
    this.centerX     = TILE_VISUAL_GAP + this.visW / 2;
    this.fillAnchorY = TILE_VISUAL_GAP + this.bodyH;
    this.fillMaxH    = this.bodyH;

    // Dome arc geometry — matches HoldTileTextures.bakeDome() exactly.
    this.domeDy     = this.visW * 0.866025; // sin(60°) = sqrt(3)/2
    this.domeHeight = this.visW - this.domeDy;
    this.domeRTH    = Math.ceil(this.domeHeight) + 2; // must match bakeDome()

    // ── Legacy CSS match: 1-slot absolute base + dynamic stretching top ───
    const singleTileH = tileHeight / Math.max(1, tile.slotSpan);
    const bodyBaseH   = Math.round(singleTileH);
    const bodyTopH    = Math.max(0, tileHeight - bodyBaseH);

    // ── Body top sprite (upper portion: top down to 1 base height) ─────────
    // Fades smoothly from #1565c0 to #0e3a6e, just like the old React CSS tile
    this.bodyTopSprite = scene.add.image(
      this.centerX,
      TILE_VISUAL_GAP,
      holdTextureKey('body-top', this.visW),
    );
    this.bodyTopSprite.setOrigin(0.5, 0);
    this.bodyTopSprite.scaleY = bodyTopH / 256;
    this.bodyTopSprite.scaleX = 1;

    // ── Body base sprite (lower portion: precisely 1 slot height) ──────────
    // Fades from #0e3a6e to black (bottom 40% solid black). Match CSS exactly.
    // Pulled up by 1px to cleanly overlap with bodyTopSprite (no seam).
    this.bodyBaseSprite = scene.add.image(
      this.centerX,
      tileHeight - bodyBaseH - 1,
      holdTextureKey('body-base', this.visW),
    );
    this.bodyBaseSprite.setOrigin(0.5, 0);
    // Expand by 1px for the overlap
    this.bodyBaseSprite.scaleY = (bodyBaseH + 1) / 256;
    this.bodyBaseSprite.scaleX = 1;

    // ── Laser sprite — ADD blend glow strip at tile center ─────────────────
    this.laserSprite = scene.add.image(
      this.centerX - 1,
      TILE_VISUAL_GAP,
      holdTextureKey('laser', this.visW),
    );
    this.laserSprite.setOrigin(0, 0);
    this.laserSprite.scaleY = (tileHeight - 2 * TILE_VISUAL_GAP) / 256;
    this.laserSprite.setBlendMode(Phaser.BlendModes.ADD);

    // ── Fill rectangle ─────────────────────────────────────────────────────
    // Grows upward from fillAnchorY via scaleY each frame.
    // Origin (0.5, 1): the rect is centered horizontally and anchored at its bottom edge.
    this.fillRect = scene.add.rectangle(
      this.centerX,
      this.fillAnchorY,
      this.visW,
      this.bodyH,
      HOLD_FILL_COLOR,
    );
    this.fillRect.setOrigin(0.5, 1); // bottom-center pivot
    this.fillRect.scaleY = 0;
    this.fillRect.setVisible(false);

    // ── Dome sprite ───────────────────────────────────────────────────────
    // Uses the shared 'hold-dome-{W}' canvas texture.
    // Starts invisible; shown and repositioned each frame during a hold.
    this.domeSprite = scene.add.image(
      TILE_VISUAL_GAP, // left edge of visual area
      0,               // Y updated every frame in updateFillSprites()
      holdTextureKey('dome', this.visW),
    );
    this.domeSprite.setOrigin(0, 0); // top-left anchor so setY() positions the top edge
    this.domeSprite.setVisible(false);

    // ── Tap-ring sprite ───────────────────────────────────────────────────
    // Positioned 80px above the tile's bottom edge, sitting on the laser line.
    this.tapRingSprite = scene.add.image(
      this.centerX,
      this.tileHeight - 80, // 80px from the bottom of the tile
      holdTextureKey('tapring', this.visW),
    );
    this.tapRingSprite.setOrigin(0.5, 0.5);
    this.tapRingSprite.setAlpha(1);

    // ── Render order (back to front) ──────────────────────────────────────
    this.add([
      this.bodyTopSprite,
      this.bodyBaseSprite,
      this.laserSprite,
      this.fillRect,
      this.domeSprite,
      this.tapRingSprite,
    ]);

    // ── Build beat detection descriptors (NO game objects) ─────────────────
    // We store world-Y positions as plain numbers — no Arc objects per tile.
    // The decoration pool provides dot sprites when they are actually needed on tap.
    this.buildBeatDotDescriptors();
  }

  // ---------------------------------------------------------------------------
  // BaseTileObject overrides
  // ---------------------------------------------------------------------------

  getTileType(): 'HOLD' {
    return 'HOLD';
  }

  /**
   * Called by InputSystem when the player's finger lands on this tile.
   * Captures the tap position, starts the fill animation, and borrows
   * decoration sprites from the scene-level pool.
   *
   * @param speedMultiplier  - Playback speed (1 = normal). Scales tween durations.
   * @param worldY           - World-space Y of the tap (anchors fill to the finger).
   * @param _slotDurationMs  - Slot duration in ms (unused — fill is camera-driven).
   */
  onTap(speedMultiplier = 1, worldY?: number, _slotDurationMs = 0): void {
    if (this.tapped) return;
    this.tapped = true;
    this.speedMultiplier = speedMultiplier;

    const primaryNote = this.gameTile.notes[0];
    if (!primaryNote) return;

    // ── Capture tap position in screen space ────────────────────────────────
    // tapScreenY = worldY − scrollY at tap time. Each frame we re-add the current
    // scrollY to get the tap's current world Y, driving fill height.
    let tapDistFromBottom = 0;
    if (worldY !== undefined) {
      this.tapScreenY   = worldY - this.scene.cameras.main.scrollY;
      tapDistFromBottom = (this.y + this.tileHeight) - worldY;
    } else {
      this.tapScreenY   = (this.y + this.tileHeight) - this.scene.cameras.main.scrollY;
    }
    tapDistFromBottom = Math.max(0, Math.min(this.tileHeight, tapDistFromBottom));

    // ── Initial fill height ─────────────────────────────────────────────────
    // Position the dome apex DOT_OFFSET_PX above the tap point from the first frame.
    const initialFillH = Math.max(
      0,
      tapDistFromBottom + DOT_OFFSET_PX - this.capH + this.domeDy - this.visW,
    );
    this.fillHeight = initialFillH;
    this.updateFillSprites();

    // ── Hide tapRing on tap — it was a pre-tap indicator only —
    this.tapRingSprite.setVisible(false);

    // ── Borrow dot sprites and position them ────────────────────────────────
    // Each static beat descriptor gets a dot sprite from the pool.
    this.activeDots = new Array(this.staticBeatDots.length).fill(null);
    this.updateBeatDotPositions(tapDistFromBottom);

    for (let i = 0; i < this.staticBeatDots.length; i++) {
      const dot = this.decorPool.borrowDot();
      if (dot) {
        this.activeDots[i] = dot;
        // worldY of this dot = tile container Y + local dot Y
        const dotWorldX = this.x + this.centerX;
        const dotWorldY = this.y + (this.staticBeatDots[i].worldY);
        dot.image.setPosition(dotWorldX, dotWorldY);
        dot.image.setAlpha(0);
        dot.image.setVisible(true);
        // Fade in
        this.scene.tweens.add({
          targets: dot.image,
          alpha: 1,
          duration: 100 / this.speedMultiplier,
        });
      }
    }

    // ── Start physics loop ─────────────────────────────────────────────────
    this.firedDots.clear();
    this.lastApexY  = undefined;
    this.isHolding  = true;
    this.scene.events.off('update', this.onPhysicsUpdate, this);
    this.scene.events.on('update', this.onPhysicsUpdate, this);
  }

  /**
   * Called by InputSystem on pointerup or pointercancel.
   * Stops the physics loop, flattens the dome, and returns all borrowed decorations.
   */
  onRelease(): void {
    if (!this.tapped) return;

    this.isHolding = false;
    this.scene.events.off('update', this.onPhysicsUpdate, this);
    this.lastApexY = undefined;
    this.firedDots.clear();

    // Preserve the dome cap exactly where the player released.
    this.updateFillSprites(false);

    // Return all borrowed dot sprites to the pool.
    for (const dot of this.activeDots) {
      if (dot) this.decorPool.returnItem(dot);
    }
    this.activeDots = [];

    // tapRingSprite is already hidden via setVisible(false) on tap.

    // Apply semantic tapped state without visually greying out the tile
    this.markTapped();
  }

  // ---------------------------------------------------------------------------
  // Protected overrides
  // ---------------------------------------------------------------------------

  /**
   * Overrides BaseTileObject.markTapped() for Hold Tiles.
   * Hold tiles should preserve their blue fill progress when the user lifts early,
   * so we explicitly prevent it from dynamically recoloring the fillRect to grey.
   */
  protected markTapped(): void {
    this.tapped = true;
  }

  // ---------------------------------------------------------------------------
  // Per-frame physics update (hot path)
  // ---------------------------------------------------------------------------

  /**
   * Registered on scene.events('update') during a hold; runs ~60× per second.
   *
   * PERFORMANCE — nothing here allocates memory or does layout arithmetic:
   *   - All constants read from pre-computed readonly fields.
   *   - updateFillSprites() = scaleY + setY only (two property writes).
   *   - firedDots.has() = O(1) Set lookup.
   *   - Beat dot position updates via setPosition() on shared pool sprites.
   *
   * @param _time  - Scene time (unused; fill is camera-scroll driven).
   * @param _delta - Frame delta (unused).
   */
  private onPhysicsUpdate(_time: number, _delta: number): void {
    if (!this.isHolding) return;

    // Re-derive tap world Y by adding current scrollY back to the captured screen Y.
    const currentWorldY   = this.tapScreenY + this.scene.cameras.main.scrollY;
    let tapDistFromBottom = (this.y + this.tileHeight) - currentWorldY;
    tapDistFromBottom     = Math.max(0, Math.min(this.tileHeight, tapDistFromBottom));

    // Compute new fill height. Uses only pre-computed readonly fields.
    let newHeight = Math.max(0, tapDistFromBottom + DOT_OFFSET_PX - this.capH + this.domeDy - this.visW);
    newHeight     = Math.min(newHeight, this.fillMaxH);
    this.fillHeight = newHeight;

    // Update dot sprite world positions as the camera scrolls.
    // Dot sprites live in WORLD space (not the container), so they must be
    // repositioned as the camera moves.
    for (let i = 0; i < this.activeDots.length; i++) {
      const dot = this.activeDots[i];
      if (dot && !this.firedDots.has(i)) {
        dot.image.setY(this.y + this.staticBeatDots[i].worldY);
      }
    }

    // ── Spatial beat crossing detection ───────────────────────────────────
    const currentApexY = this.tileHeight - TILE_VISUAL_GAP - tapDistFromBottom - DOT_OFFSET_PX;
    if (this.lastApexY !== undefined) {
      for (let i = 0; i < this.staticBeatDots.length; i++) {
        if (this.firedDots.has(i)) continue;
        const dotLocalY = this.staticBeatDots[i].worldY;
        if (currentApexY <= dotLocalY && dotLocalY < this.lastApexY) {
          this.firedDots.add(i);
          this.fireBeat(this.staticBeatDots[i].notes, i);
        }
      }
    }
    this.lastApexY = currentApexY;

    // Reposition fill sprites — the only visual work per frame.
    this.updateFillSprites();

    // Auto-complete when fill reaches the top.
    if (newHeight >= this.fillMaxH) {
      this.isHolding = false;
      this.scene.events.off('update', this.onPhysicsUpdate, this);
      this.updateFillSprites(true);
    }
  }

  // ---------------------------------------------------------------------------
  // Fill sprite update (the per-frame render method)
  // ---------------------------------------------------------------------------

  /**
   * Updates fillRect.scaleY and domeSprite.setY() to reflect the current fillHeight.
   * Called once per frame during holds, once on tap, and once on release.
   *
   * PERFORMANCE: zero Graphics operations per call. Only two property writes:
   *   fillRect.scaleY + domeSprite.setY (plus follower position).
   *
   * @param forceFlat - On release: hide dome, show flat-topped fill (signals completion).
   */
  private updateFillSprites(forceFlat = false): void {
    const h = this.fillHeight;

    if (h <= 0 && !forceFlat) {
      this.fillRect.setVisible(false);
      this.domeSprite.setVisible(false);
      return;
    }

    // Show the fill rect and scale it to the current height.
    // Origin (0.5, 1) makes it grow upward from fillAnchorY.
    this.fillRect.setVisible(true);
    this.fillRect.scaleY = h / this.bodyH;

    if (forceFlat) {
      // Flat top = release or auto-complete signal. Hide dome.
      this.domeSprite.setVisible(false);
    } else {
      // Position dome so its chord (bottom edge) aligns with the fill rect's top.
      // Fill rect top (in container local Y) = fillAnchorY - h.
      // Dome texture: internal chord is at y = domeRTH - 1 from the sprite's top-left.
      // So dome top-left Y = (fillAnchorY - h) - (domeRTH - 1).
      const chordY   = this.fillAnchorY - h;
      // +1px downward to overlap the fillRect edge explicitly to hide the WebGL seam
      const domeTopY = chordY - (this.domeRTH - 1) + 1;

      this.domeSprite.setVisible(true);
      // Clamp the dome so it never protrudes past the top of the tile.
      // As the square fillRect continues rising beneath it, the curved top will 
      // naturally be overwritten by the square corners, perfectly "squishing" it flat!
      this.domeSprite.setY(Math.max(TILE_VISUAL_GAP, domeTopY));
    }

    // ── Lock tracking decorations to the dome apex ────────────────────────
    // Causes ripples and the flashing follower dot to "ride" the moving apex
    if (this.activeTrackingDecorations.length > 0) {
      const apexWorldY = this.y + this.domeSprite.y;
      for (const img of this.activeTrackingDecorations) {
        if (img.active && img.visible) {
          img.setY(apexWorldY);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Beat detection helpers
  // ---------------------------------------------------------------------------

  /**
   * Computes local-Y positions for each secondary beat group and stores them
   * as plain numbers — NO game objects are created here.
   *
   * The Y values are stored as local container coordinates.
   * They are converted to world coordinates in onPhysicsUpdate() by adding this.y.
   *
   * WHY no Arc objects per tile:
   *   Previously each beat dot was a Phaser Arc created in the constructor and kept
   *   for the tile's lifetime. With 30 hold tiles × 3 dots each = 90 permanent Arcs.
   *   Now dots are borrowed from the scene pool on tap (max 9 at any moment)
   *   and returned immediately after the hold ends.
   */
  private buildBeatDotDescriptors(): void {
    const primaryNote = this.gameTile.notes[0];
    if (!primaryNote) return;

    // Group notes by time, excluding the primary note's time.
    const grouped = new Map<number, ParsedNote[]>();
    for (const note of this.gameTile.notes) {
      if (note.time !== primaryNote.time) {
        if (!grouped.has(note.time)) grouped.set(note.time, []);
        grouped.get(note.time)!.push(note);
      }
    }

    const slotSpanMultiplier = Math.max(1, Math.round(this.gameTile.slotSpan));
    const singleTileH        = this.tileHeight / slotSpanMultiplier;
    const visualBottomY      = this.tileHeight - TILE_VISUAL_GAP;
    // Default tap offset (placeholder Y before the real tap is known).
    const defaultTapOffset   = this.capH / 2;

    const times = Array.from(grouped.keys()).sort((a, b) => a - b);
    for (const time of times) {
      const notes      = grouped.get(time)!;
      const slotOffset = notes[0].slotStart - primaryNote.slotStart;
      const dotPxFromBottom = defaultTapOffset + (slotOffset * singleTileH) + DOT_OFFSET_PX;
      // worldY here is local container Y — converted to real world Y in onPhysicsUpdate().
      const dotLocalY = visualBottomY - dotPxFromBottom;

      this.staticBeatDots.push({
        worldY: dotLocalY,
        timeOffsetMs: (time - primaryNote.time) * 1000,
        notes,
      });
    }
  }

  /**
   * Recomputes local dot Y positions based on the actual tap location.
   * Called once in onTap() after tapDistFromBottom is known.
   *
   * This corrects the placeholder Y set by buildBeatDotDescriptors() so the
   * crossing detection works regardless of where on the tile the player tapped.
   *
   * @param tapDistFromBottom - px from tap world Y to tile bottom edge.
   */
  private updateBeatDotPositions(tapDistFromBottom: number): void {
    const primaryNote        = this.gameTile.notes[0];
    if (!primaryNote) return;
    const slotSpanMultiplier = Math.max(1, Math.round(this.gameTile.slotSpan));
    const singleTileH        = this.tileHeight / slotSpanMultiplier;
    const visualBottomY      = this.tileHeight - TILE_VISUAL_GAP;

    for (let i = 0; i < this.staticBeatDots.length; i++) {
      const slotOffset      = this.staticBeatDots[i].notes[0].slotStart - primaryNote.slotStart;
      const dotPxFromBottom = tapDistFromBottom + (slotOffset * singleTileH) + DOT_OFFSET_PX;
      this.staticBeatDots[i].worldY = visualBottomY - dotPxFromBottom;
    }
  }

  /**
   * Fires a secondary beat: plays audio and triggers a sonar ripple from the pool.
   *
   * PERFORMANCE: borrows sprites from the scene-level pool.
   * No game objects are created here. 
   *
   * @param notes    - Notes to play via scene audio system.
   * @param dotIndex - Index into staticBeatDots; used to hide the corresponding dot.
   */
  private fireBeat(notes: ParsedNote[], dotIndex: number): void {
    // Trigger audio via the scene (decoupled from concrete scene type via any cast).
    (this.scene as any).handleHoldBeat?.(notes);

    // Hide the active dot sprite now that it has been "consumed" by the ripple.
    const dot = this.activeDots[dotIndex];
    if (dot) {
      dot.image.setAlpha(0);
    }

    const dotWorldX = this.x + this.centerX;
    const dotWorldY = dot ? dot.image.y : this.y + (this.staticBeatDots[dotIndex]?.worldY ?? 0);

    // ── Borrow a ripple from the scene pool ────────────────────────────────
    const ripple = this.decorPool.borrowRipple();
    if (ripple) {
      ripple.image.setPosition(dotWorldX, dotWorldY);
      ripple.image.setScale(1);
      ripple.image.setAlpha(0.9);
      ripple.image.setVisible(true);

      // Add to tracking array so it geometrically rides the dome apex!
      this.activeTrackingDecorations.push(ripple.image);

      this.scene.tweens.add({
        targets: ripple.image,
        scale: 4.5,
        alpha: 0,
        duration: 250,
        ease: 'Quad.out',
        onComplete: () => {
          this.activeTrackingDecorations = this.activeTrackingDecorations.filter(img => img !== ripple.image);
          this.decorPool.returnItem(ripple);
        }
      });
    }

    // ── Borrow an apex dot from the scene pool ─────────────────────────────
    // Spawns a glowing dot identically at the physical tracked apex of the dome.
    // Mimics React arcDot pulse: flash in, hold slightly, then fade out.
    const apexDot = this.decorPool.borrowDot();
    if (apexDot) {
      const apexWorldY = this.y + this.domeSprite.y;
      apexDot.image.setPosition(dotWorldX, apexWorldY);
      apexDot.image.setScale(1.2);
      apexDot.image.setAlpha(0.9);
      apexDot.image.setBlendMode(Phaser.BlendModes.ADD);
      apexDot.image.setVisible(true);

      // Add to tracking array so it geometrically rides the dome apex while animating!
      this.activeTrackingDecorations.push(apexDot.image);

      this.scene.tweens.add({
        targets: apexDot.image,
        scale: 2.5,
        alpha: 0,
        duration: 200,
        ease: 'Cubic.out',
        onComplete: () => {
          this.activeTrackingDecorations = this.activeTrackingDecorations.filter(img => img !== apexDot.image);
          this.decorPool.returnItem(apexDot);
        },
      });
    }
  }
}
