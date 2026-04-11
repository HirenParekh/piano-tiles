import Phaser from 'phaser';
import type { GameTile, ParsedNote } from '../../types/midi';
import { BaseTileObject, TILE_VISUAL_GAP } from './BaseTileObject';
import type { HoldDecorationPool, PooledDot } from './HoldDecorationPool';

/**
 * The follower dot (dome apex indicator) sits this many pixels above the tap point.
 */
const DOT_OFFSET_PX = 120;

export class HoldTileObjectV2 extends BaseTileObject {
  // Pre-computed geometry
  private readonly visW: number;
  private readonly capH: number;
  private readonly bodyH: number;
  private readonly centerX: number;
  private readonly fillAnchorY: number;
  private readonly fillMaxH: number;
  private readonly spriteScaleX: number;
  
  // Game Objects
  private readonly bodySprite: Phaser.GameObjects.Image;
  private readonly headSprite: Phaser.GameObjects.Image;
  private readonly fillSprite: Phaser.GameObjects.Image;
  private readonly domeSprite: Phaser.GameObjects.Image;

  // Pool
  private readonly decorPool: HoldDecorationPool;
  private activeDots: (PooledDot | null)[] = [];
  private activeTrackingDecorations: Phaser.GameObjects.Image[] = [];

  // Beat detection state
  private staticBeatDots: { worldY: number; timeOffsetMs: number; notes: ParsedNote[] }[] = [];
  private firedDots = new Set<number>();

  // Physics state
  private lastApexY: number | undefined;
  private fillHeight = 0;
  private isHolding = false;
  private isCompleted = false;
  private tapScreenY = 0;
  private speedMultiplier = 1;

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

    // Pre-compute basic geometry
    this.visW = tileWidth - 2 * TILE_VISUAL_GAP;
    this.capH = 0;
    this.bodyH = tileHeight - this.capH - 2 * TILE_VISUAL_GAP;
    this.centerX = TILE_VISUAL_GAP + this.visW / 2;
    this.fillAnchorY = this.tileHeight; 
    this.fillMaxH = this.bodyH;

    // Sprite Original Dimensions (from plist)
    const ORIGINAL_W = 134;
    const BODY_H = 240;
    const HEAD_H = 324;
    const FILL_H = 238;

    this.spriteScaleX = this.visW / ORIGINAL_W;

    // 1. Body Sprite (tile during hold)
    this.bodySprite = scene.add.image(this.centerX, 0, 'hold-body');
    this.bodySprite.setOrigin(0.5, 0); // Top-center pivot
    this.bodySprite.setScale(this.spriteScaleX, tileHeight / BODY_H);

    // 2. Head Sprite (glow ring + laser indicator)
    this.headSprite = scene.add.image(this.centerX, this.bodyH, 'hold-head');
    this.headSprite.setOrigin(0.5, 1); // Bottom-center pivot
    this.headSprite.setScale(this.spriteScaleX, this.spriteScaleX);
    
    // Crop the head if the tile is shorter than the head sprite
    const headVisH = Math.round(Math.min(HEAD_H, this.bodyH / this.spriteScaleX));
    this.headSprite.setCrop(0, HEAD_H - headVisH, ORIGINAL_W, headVisH);

    // 3. Fill Sprite (progress)
    this.fillSprite = scene.add.image(this.centerX, this.fillAnchorY, 'hold-fill');
    this.fillSprite.setOrigin(0.5, 1); // Bottom-center pivot
    this.fillSprite.setScale(this.spriteScaleX, this.spriteScaleX); // Maintain native aspect ratio but stretch Y during setCrop
    this.fillSprite.setCrop(0, FILL_H, ORIGINAL_W, 0);
    this.fillSprite.setVisible(false);

    // 4. Dome Sprite (rising cap)
    this.domeSprite = scene.add.image(this.centerX, this.fillAnchorY, 'hold-dome');
    // The brightest point of the dome is ~21px from the top. 
    // Setting origin Y to 21/218 perfectly aligns the visual apex with the math apex!
    this.domeSprite.setOrigin(0.5, 21 / 218); 
    this.domeSprite.setScale(this.spriteScaleX, this.spriteScaleX);
    this.domeSprite.setVisible(false);

    // Add in consistent render order
    this.add([
      this.bodySprite,
      this.fillSprite,
      this.domeSprite,
      this.headSprite
    ]);

    this.buildBeatDotDescriptors();
  }

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

    // Hide pre-tap head
    this.headSprite.setVisible(false);

    // Calculate initial fill
    const initialFillH = Math.max(0, tapDistFromBottom + DOT_OFFSET_PX - this.capH);
    this.fillHeight = initialFillH;
    this.updateFillSprites();

    // Borrow dots
    this.activeDots = new Array(this.staticBeatDots.length).fill(null);
    this.updateBeatDotPositions(tapDistFromBottom);

    for (let i = 0; i < this.staticBeatDots.length; i++) {
      const dot = this.decorPool.borrowDot();
      if (dot) {
        this.activeDots[i] = dot;
        const dotWorldX = this.x + this.centerX;
        const localY = this.staticBeatDots[i].worldY;
        const dotWorldY = this.y + localY;
        
        dot.image.setPosition(dotWorldX, dotWorldY);
        dot.image.setAlpha(0);
        
        const isWithinTile = localY >= 0 && localY <= this.tileHeight;
        dot.image.setVisible(isWithinTile);
        
        if (isWithinTile) {
          this.scene.tweens.add({
            targets: dot.image,
            alpha: 1,
            duration: 100 / this.speedMultiplier,
          });
        }
      }
    }

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

    if (!this.isCompleted) {
      // Show faded body on early release
      this.bodySprite.setTexture('hold-body-faded');
      this.updateFillSprites(false);
    }

    for (const dot of this.activeDots) {
      if (dot) this.decorPool.returnItem(dot);
    }
    this.activeDots = [];

    this.markTapped();
  }

  protected markTapped(): void {
    this.tapped = true;
  }

  private onPhysicsUpdate(_time: number, _delta: number): void {
    if (!this.isHolding) return;

    const currentWorldY = this.tapScreenY + this.scene.cameras.main.scrollY;
    let tapDistFromBottom = (this.y + this.tileHeight) - currentWorldY;
    tapDistFromBottom = Math.max(0, Math.min(this.tileHeight, tapDistFromBottom));

    let newHeight = Math.max(0, tapDistFromBottom + DOT_OFFSET_PX - this.capH);
    newHeight = Math.min(newHeight, this.fillMaxH);

    const progressRatio = newHeight / this.fillMaxH;
    const SNAP_THRESHOLD = 0.90;

    if (progressRatio >= SNAP_THRESHOLD || newHeight >= this.fillMaxH) {
      newHeight = this.fillMaxH;
      tapDistFromBottom = newHeight - DOT_OFFSET_PX + this.capH;
    }

    this.fillHeight = newHeight;

    for (let i = 0; i < this.activeDots.length; i++) {
      const dot = this.activeDots[i];
      if (dot && !this.firedDots.has(i)) {
        const localY = this.staticBeatDots[i].worldY;
        const isWithinTile = localY >= 0 && localY <= this.tileHeight;
        dot.image.setVisible(isWithinTile);
        if (isWithinTile) {
          dot.image.setY(this.y + localY);
        }
      }
    }

    const currentApexY = this.tileHeight - tapDistFromBottom - DOT_OFFSET_PX;
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

    this.updateFillSprites();

    if (newHeight >= this.fillMaxH) {
      this.isHolding = false;
      this.isCompleted = true;
      this.scene.events.off('update', this.onPhysicsUpdate, this);
      this.updateFillSprites(true);
      
      this.bodySprite.setTexture('hold-finish');
      this.bodySprite.setDisplaySize(this.visW, this.tileHeight);
      this.bodySprite.setAlpha(1.0);
      
      this.fillSprite.setVisible(false);
      this.domeSprite.setVisible(false);

      // Free dots
      for (const dot of this.activeDots) {
        if (dot) this.decorPool.returnItem(dot);
      }
      this.activeDots = [];
      
      this.spawnScorePop();
    }
  }

  private updateFillSprites(forceFlat = false): void {
    const h = this.fillHeight;

    if (h <= 0 && !forceFlat) {
      this.fillSprite.setVisible(false);
      this.domeSprite.setVisible(false);
      return;
    }

    if (forceFlat) {
      this.domeSprite.setVisible(false);
      this.fillSprite.setVisible(true);
      
      const FILL_H = 238;
      // Stretch to fit the tile height
      this.fillSprite.setScale(this.spriteScaleX, h / FILL_H);
      this.fillSprite.setCrop(0, 0, 134, FILL_H);
    } else {
      // Render progress via crop
      this.fillSprite.setVisible(true);
      this.domeSprite.setVisible(true);
      
      const FILL_H = 238;
      // Calculate crop proportion
      const progress = h / this.fillMaxH;
      const cropH = Math.round(progress * FILL_H);
      
      this.fillSprite.setScale(this.spriteScaleX, this.fillMaxH / FILL_H);
      this.fillSprite.setCrop(0, FILL_H - cropH, 134, cropH);

      // Position the dome cap cleanly
      const domeY = this.fillAnchorY - h;
      this.domeSprite.setY(domeY);
    }

    if (this.activeTrackingDecorations.length > 0) {
      const apexWorldY = this.y + this.domeSprite.y;
      for (const img of this.activeTrackingDecorations) {
        if (img.active && img.visible) {
          img.setY(apexWorldY);
        }
      }
    }
  }
  
  private spawnScorePop(): void {
    const scoreText = this.scene.add.text(
      this.x + this.tileWidth / 2,
      this.y,
      `+${Math.floor(this.gameTile.slotSpan) + 1}`,
      { fontSize: '28px', fontFamily: 'sans-serif', color: '#00ccff', stroke: '#0055aa', strokeThickness: 2 }
    );
    scoreText.setOrigin(0.5, 1);
    scoreText.setDepth(20);

    this.scene.tweens.add({
      targets: scoreText,
      y: scoreText.y - 60,
      alpha: 0,
      scale: 1.3,
      duration: 600,
      ease: 'Cubic.out',
      onComplete: () => scoreText.destroy()
    });
  }

  private buildBeatDotDescriptors(): void {
    const primaryNote = this.gameTile.notes[0];
    if (!primaryNote) return;

    const grouped = new Map<number, ParsedNote[]>();
    for (const note of this.gameTile.notes) {
      if (note.time !== primaryNote.time) {
        if (!grouped.has(note.time)) grouped.set(note.time, []);
        grouped.get(note.time)!.push(note);
      }
    }

    const slotSpanMultiplier = Math.max(1, Math.round(this.gameTile.slotSpan));
    const singleTileH = this.tileHeight / slotSpanMultiplier;
    const visualBottomY = this.tileHeight;

    const times = Array.from(grouped.keys()).sort((a, b) => a - b);
    for (const time of times) {
      const notes = grouped.get(time)!;
      const slotOffset = notes[0].slotStart - primaryNote.slotStart;
      const dotPxFromBottom = (slotOffset * singleTileH) + DOT_OFFSET_PX;
      const dotLocalY = visualBottomY - dotPxFromBottom;

      this.staticBeatDots.push({
        worldY: dotLocalY,
        timeOffsetMs: (time - primaryNote.time) * 1000,
        notes,
      });
    }
  }

  private updateBeatDotPositions(tapDistFromBottom: number): void {
    const primaryNote = this.gameTile.notes[0];
    if (!primaryNote) return;
    const slotSpanMultiplier = Math.max(1, Math.round(this.gameTile.slotSpan));
    const singleTileH = this.tileHeight / slotSpanMultiplier;
    const visualBottomY = this.tileHeight;

    for (let i = 0; i < this.staticBeatDots.length; i++) {
      const slotOffset = this.staticBeatDots[i].notes[0].slotStart - primaryNote.slotStart;
      const dotPxFromBottom = tapDistFromBottom + (slotOffset * singleTileH) + DOT_OFFSET_PX;
      this.staticBeatDots[i].worldY = visualBottomY - dotPxFromBottom;
    }
  }

  private fireBeat(notes: ParsedNote[], dotIndex: number): void {
    (this.scene as any).handleHoldBeat?.(notes);

    const dot = this.activeDots[dotIndex];
    if (dot) {
      dot.image.setAlpha(0); // Hide the resting static dot
    }

    const dotWorldX = this.x + this.centerX;
    const dotWorldY = dot ? dot.image.y : this.y + (this.staticBeatDots[dotIndex]?.worldY ?? 0);

    // 1. The expanding/shrinking dot_light.png
    const glowDot = this.decorPool.borrowGlowDot();
    if (glowDot) {
      glowDot.image.setPosition(dotWorldX, dotWorldY);
      glowDot.image.setScale(0.8);
      glowDot.image.setAlpha(1.0);
      glowDot.image.setBlendMode(Phaser.BlendModes.ADD);
      glowDot.image.setVisible(true);

      this.activeTrackingDecorations.push(glowDot.image);

      this.scene.tweens.chain({
        targets: glowDot.image,
        tweens: [
          {
            scale: 1.0,
            duration: 60,
            ease: 'Sine.out'
          },
          {
            scale: 0.7,
            alpha: 0,
            duration: 180,
            ease: 'Sine.in'
          }
        ],
        onComplete: () => {
          this.activeTrackingDecorations = this.activeTrackingDecorations.filter(img => img !== glowDot.image);
          this.decorPool.returnItem(glowDot);
        }
      });
    }

    // 2. The out-blasting glow.png ripple
    const ripple = this.decorPool.borrowRipple();
    if (ripple) {
      ripple.image.setPosition(dotWorldX, dotWorldY);
      ripple.image.setScale(0.3);
      ripple.image.setAlpha(0.6);
      ripple.image.setBlendMode(Phaser.BlendModes.ADD);
      ripple.image.setVisible(true);

      this.activeTrackingDecorations.push(ripple.image);

      this.scene.tweens.add({
        targets: ripple.image,
        scale: 2.5,
        alpha: 0,
        duration: 300,
        ease: 'Cubic.out',
        onComplete: () => {
          this.activeTrackingDecorations = this.activeTrackingDecorations.filter(img => img !== ripple.image);
          this.decorPool.returnItem(ripple);
        }
      });
    }
  }

  // Debug Helpers
  public debugSetFill(height: number): void {
    this.fillHeight = height;
    this.updateFillSprites();
  }

  public debugSetCompleted(val: boolean): void {
    this.isCompleted = val;
    if (val) {
      this.bodySprite.setTexture('hold-finish');
      this.bodySprite.setDisplaySize(this.visW, this.tileHeight);
      this.bodySprite.setAlpha(1.0);
      this.fillSprite.setVisible(false);
      this.domeSprite.setVisible(false);
    } else {
      this.bodySprite.setTexture('hold-body');
      this.updateFillSprites();
    }
  }
}
