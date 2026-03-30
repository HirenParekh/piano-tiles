/**
 * FXSandboxScene.ts
 *
 * A dedicated isolation scene for testing visual effects (ripples, sparks, etc.)
 * in isolation, away from the complexities of the full game board.
 *
 * ACCESS:
 *   - Visit localhost:3000/?scene=fx
 *   - Or click "⚙️ Debug Sandbox" on the Home Screen.
 */

import Phaser from 'phaser';
import { Pane } from 'tweakpane';
import { HoldDecorationPool } from '../tile-objects/HoldDecorationPool';
import { bakeHoldTileTextures, HOLD_TILE_COLORS } from '../tile-objects/HoldTileTextures';
import { HoldTileObject } from '../tile-objects/HoldTileObject';

export const FX_SANDBOX_SCENE_KEY = 'FXSandboxScene';

export class FXSandboxScene extends Phaser.Scene {
  private decorPool: HoldDecorationPool | null = null;
  private testTile: HoldTileObject | null = null;
  private pane: any = null;

  // ── Tweakable Parameters ──────────────────────────────────────────────────
  private config = {
    ripple: {
      initialScale: 0.25,
      targetScale: 2.0,
      initialAlpha: 0.6,
      duration: 220,
      ease: 'Quad.out',
      color: '#00cfff',
    },
    system: {
      backgroundColor: '#0a0a14',
    },
    holdTile: {
      fillHeight: 300,
      isCompleted: false
    }
  };

  constructor() {
    super(FX_SANDBOX_SCENE_KEY);
  }

  create(): void {
    const { width } = this.scale;

    // ── Pre-bake textures ────────────────────────────────────────────────────
    // Use a fixed lane width (e.g., 150px) for the shared textures.
    bakeHoldTileTextures(this, 150);

    // ── Build Pool ────────────────────────────────────────────────────────────
    this.decorPool = new HoldDecorationPool(this, 150);

    // ── Build Test Tile ───────────────────────────────────────────────────────
    const mockTile = { lane: 1, time: 0, duration: 1000, isHold: true, notes: [] };
    this.testTile = new HoldTileObject(this, width / 2 - 75, 200, 150, 500, mockTile as any, this.decorPool);
    this.add.existing(this.testTile);
    this.testTile.debugSetFill(this.config.holdTile.fillHeight);

    // ── Set Background ────────────────────────────────────────────────────────
    this.cameras.main.setBackgroundColor(this.config.system.backgroundColor);

    // ── Instructions ──────────────────────────────────────────────────────────
    this.add.text(width / 2, 40, 'FX SANDBOX', { 
      fontSize: '28px', 
      fontStyle: 'bold', 
      color: '#ffffff',
      fontFamily: 'sans-serif' 
    }).setOrigin(0.5);

    this.add.text(width / 2, 80, 'CLICK ANYWHERE TO REPRODUCE THE RIPPLE EFFECT', { 
      fontSize: '14px', 
      color: '#8888ff',
      fontFamily: 'sans-serif' 
    }).setOrigin(0.5);

    // ── Tweakpane Setup ───────────────────────────────────────────────────────
    this.setupGui();

    // ── Interaction ───────────────────────────────────────────────────────────
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.spawnRipple(pointer.x, pointer.y);
    });

    // Cleanup pane on scene shutdown
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.pane?.dispose();
    });
  }

  private setupGui(): void {
    this.pane = new Pane();
    this.pane.element.style.top = '20px';
    this.pane.element.style.right = '20px';

    const fld = this.pane.addFolder({ title: 'RIPPLE SETTINGS' });
    fld.addBinding(this.config.ripple, 'initialScale', { min: 0.05, max: 1.0 });
    fld.addBinding(this.config.ripple, 'targetScale', { min: 0.5, max: 10.0 });
    fld.addBinding(this.config.ripple, 'initialAlpha', { min: 0.1, max: 1.0 });
    fld.addBinding(this.config.ripple, 'duration', { min: 100, max: 2000, step: 10 });
    fld.addBinding(this.config.ripple, 'ease', {
      options: {
        CubicOut: 'Cubic.out',
        QuadOut: 'Quad.out',
        Linear: 'Linear',
        ExpoOut: 'Expo.out',
      }
    });

    const sys = this.pane.addFolder({ title: 'SYSTEM' });
    sys.addBinding(this.config.system, 'backgroundColor').on('change', (ev: any) => {
       this.cameras.main.setBackgroundColor(ev.value);
    });

    const hold = this.pane.addFolder({ title: 'HOLD TILE TUNER' });
    hold.addBinding(this.config.holdTile, 'fillHeight', { min: 0, max: 500 }).on('change', (ev: any) => {
      this.testTile?.debugSetFill(ev.value);
    });
    hold.addBinding(this.config.holdTile, 'isCompleted').on('change', (ev: any) => {
      this.testTile?.debugSetCompleted(ev.value);
    });

    hold.addBinding(HOLD_TILE_COLORS, 'bulletStop', { min: 0.0, max: 1.0 }).on('change', () => this.refreshTextures());
    hold.addBinding(HOLD_TILE_COLORS, 'fillStart', { min: 0.0, max: 1.0 }).on('change', () => this.refreshTextures());
    hold.addBinding(HOLD_TILE_COLORS, 'fillStop', { min: 0.0, max: 1.0 }).on('change', () => this.refreshTextures());
    hold.addBinding(HOLD_TILE_COLORS, 'bulletTailH', { min: 0, max: 200, step: 1 }).on('change', () => this.refreshTextures());

    // ── Live Color Tuning ───────────────────────────────────────────────────
    const colors = hold.addFolder({ title: 'COLORS (RE-BAKES ON CHANGE)', expanded: true });
    
    // Bind directly to the global configuration object in HoldTileTextures
    colors.addBinding(HOLD_TILE_COLORS, 'bulletTop').on('change', () => this.refreshTextures());
    colors.addBinding(HOLD_TILE_COLORS, 'bulletBot').on('change', () => this.refreshTextures());
    colors.addBinding(HOLD_TILE_COLORS, 'fillTop').on('change', () => this.refreshTextures());
    colors.addBinding(HOLD_TILE_COLORS, 'fillBot').on('change', () => this.refreshTextures());
    colors.addBinding(HOLD_TILE_COLORS, 'showGlow').on('change', () => this.refreshTextures());
    colors.addBinding(HOLD_TILE_COLORS, 'glowColor').on('change', () => this.refreshTextures());

    this.pane.addButton({ title: 'CLEAR ALL' });
  }

  /**
   * Re-bakes all textures and refreshes the test tile.
   * Runs whenever a color value is changed in Tweakpane.
   */
  private refreshTextures(): void {
    bakeHoldTileTextures(this, 150, true);
    // After re-baking, we must tell the test tile to update its visuals.
    if (this.testTile) {
      this.testTile.debugSetFill(this.config.holdTile.fillHeight);
    }
  }

  private spawnRipple(x: number, y: number): void {
    if (!this.decorPool) return;

    const ripple = this.decorPool.borrowRipple();
    if (ripple) {
      const cfg = this.config.ripple;

      ripple.image.setPosition(x, y);
      ripple.image.setScale(cfg.initialScale);
      ripple.image.setAlpha(cfg.initialAlpha);
      ripple.image.setBlendMode(Phaser.BlendModes.ADD);
      ripple.image.setVisible(true);

      this.tweens.add({
        targets: ripple.image,
        scale: cfg.targetScale,
        alpha: 0,
        duration: cfg.duration,
        ease: cfg.ease,
        onComplete: () => {
          this.decorPool?.returnItem(ripple);
        }
      });
    }
  }
}
