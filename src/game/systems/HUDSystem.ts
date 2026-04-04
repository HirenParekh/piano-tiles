/**
 * HUDSystem.ts
 *
 * Renders the in-game heads-up display: score counter, back button, and FPS debug counter.
 *
 * RESPONSIBILITY:
 *   - Own and display the score counter.
 *   - Own and display the back button, emitting EXIT_GAME when tapped.
 *   - All elements are pinned to screen coordinates via setScrollFactor(0).
 *
 * DOES NOT:
 *   - Know about tiles, audio, scroll math, or camera logic.
 *   - Know about React — communicates back only via EventBus (EXIT_GAME).
 */

import Phaser from 'phaser';
import { EventBus, PianoEvents } from '../EventBus';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEPTH_HUD = 1000;

const SCORE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontSize: '48px',
  fontFamily: 'Arial, sans-serif',
  fontStyle: 'bold',
  color: '#ff4b4b',
  stroke: '#ffffff',
  strokeThickness: 3,
  shadow: { offsetX: 0, offsetY: 2, color: 'rgba(0,0,0,0.3)', blur: 8, fill: true },
  align: 'center',
};

const BACK_ARROW_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontSize: '32px',
  fontFamily: 'Arial, sans-serif',
  color: '#ffffff',
  stroke: '#000000',
  strokeThickness: 3,
  shadow: { offsetX: 0, offsetY: 2, color: 'rgba(0,0,0,0.4)', blur: 8, fill: true },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface HUDCallbacks {
  onToggleMarkers: (active: boolean) => void;
  onToggleInteractiveScroll: (active: boolean) => void;
  onToggleAutoScroll: (active: boolean) => void;
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class HUDSystem {
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly fpsText: Phaser.GameObjects.Text;
  private readonly backArrow: Phaser.GameObjects.Text;
  
  private readonly dotBtn: Phaser.GameObjects.Text;
  private readonly scrollBtn: Phaser.GameObjects.Text;
  private readonly stopBtn: Phaser.GameObjects.Text;
  private readonly debugText: Phaser.GameObjects.Text;

  private score = 0;
  private markersActive = false;
  private interactiveScrollActive = false;
  private autoScrollActive = true;

  constructor(
    scene: Phaser.Scene,
    gameWidth: number,
    _gameHeight: number,
    _slotHeight: number,
    _songTitle: string,
    callbacks: HUDCallbacks,
    isDevMode: boolean = false,
  ) {
    // ── Score text ────────────────────────────────────────────────────────────
    this.scoreText = scene.add.text(gameWidth / 2, 16, '0', SCORE_STYLE);
    this.scoreText.setOrigin(0.5, 0);
    this.scoreText.setScrollFactor(0);
    this.scoreText.setDepth(DEPTH_HUD);

    // ── FPS counter ───────────────────────────────────────────────────────────
    this.fpsText = scene.add.text(gameWidth - 12, 16, 'FPS: 0', {
      fontSize: '16px',
      fontFamily: 'monospace',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { x: 6, y: 4 },
      fontStyle: 'bold',
    });
    this.fpsText.setOrigin(1, 0);
    this.fpsText.setScrollFactor(0);
    this.fpsText.setDepth(DEPTH_HUD);

    // ── Back button ───────────────────────────────────────────────────────────
    this.backArrow = scene.add.text(38, 40, '←', BACK_ARROW_STYLE);
    this.backArrow.setOrigin(0.5, 0.5);
    this.backArrow.setScrollFactor(0);
    this.backArrow.setDepth(DEPTH_HUD);
    this.backArrow.setInteractive();
    this.backArrow.on('pointerdown', () => {
      EventBus.emit(PianoEvents.EXIT_GAME);
    });

    // ── Dev Buttons logic ─────────────────────────────────────────────────────
    const btnY = 40;
    const startX = 100;
    const spacing = 50;

    // 1. Dot Toggle (●)
    this.dotBtn = scene.add.text(startX, btnY, '●', BACK_ARROW_STYLE);
    this.setupButton(this.dotBtn, () => {
      this.markersActive = !this.markersActive;
      this.dotBtn.setColor(this.markersActive ? '#e74c3c' : '#ffffff');
      callbacks.onToggleMarkers(this.markersActive);
    });

    // 2. Interactive Scroll Toggle (↕)
    this.scrollBtn = scene.add.text(startX + spacing, btnY, '↕', BACK_ARROW_STYLE);
    this.setupButton(this.scrollBtn, () => {
      this.interactiveScrollActive = !this.interactiveScrollActive;
      this.scrollBtn.setColor(this.interactiveScrollActive ? '#3498db' : '#ffffff');
      callbacks.onToggleInteractiveScroll(this.interactiveScrollActive);
    });

    // 3. Auto-Scroll Toggle (⏸)
    this.stopBtn = scene.add.text(startX + spacing * 2, btnY, '⏸', BACK_ARROW_STYLE);
    this.setupButton(this.stopBtn, () => {
      this.autoScrollActive = !this.autoScrollActive;
      this.stopBtn.setText(this.autoScrollActive ? '⏸' : '▶');
      callbacks.onToggleAutoScroll(this.autoScrollActive);
    });

    // ── Diagnostic Console ───────────────────────────────────────────────────
    this.debugText = scene.add.text(gameWidth - 12, 45, 'BUILDING DIAGNOSTICS...', {
      fontSize: '11px',
      fontFamily: 'monospace',
      color: '#00ff00',
      backgroundColor: 'rgba(0,0,0,0.85)',
      padding: { x: 4, y: 2 },
    });
    this.debugText.setOrigin(1, 0);
    this.debugText.setScrollFactor(0);
    this.debugText.setDepth(DEPTH_HUD + 10);

    // ── Dev Visibility ───────────────────────────────────────────────────────
    this.dotBtn.setVisible(isDevMode);
    this.scrollBtn.setVisible(isDevMode);
    this.stopBtn.setVisible(isDevMode);
    this.debugText.setVisible(isDevMode);
    this.fpsText.setVisible(isDevMode);
  }

  private setupButton(btn: Phaser.GameObjects.Text, onClick: () => void): void {
    btn.setOrigin(0.5, 0.5);
    btn.setScrollFactor(0);
    btn.setDepth(DEPTH_HUD);
    btn.setInteractive();
    btn.on('pointerdown', () => {
      btn.setAlpha(0.6);
      onClick();
    });
    btn.on('pointerup', () => btn.setAlpha(1));
    btn.on('pointerout', () => btn.setAlpha(1));
  }

  updateDebugInfo(nativeTaps: number, phaserTaps: number, lastHit: string): void {
    this.debugText.setText(
      `DIAGNOSTICS: Browser[${nativeTaps}] Phaser[${phaserTaps}] TopHit:[${lastHit}]`
    );
  }

  update(scene: Phaser.Scene): void {
    const fps = scene.game.loop.actualFps || 0;
    this.fpsText.setText(`FPS: ${Math.round(fps)}`);
  }

  increment(): void {
    this.score += 1;
    this.scoreText.setText(String(this.score));
    EventBus.emit(PianoEvents.SCORE_CHANGED, { score: this.score });
  }

  reset(): void {
    this.score = 0;
    this.scoreText.setText('0');
  }

  getScore(): number {
    return this.score;
  }

  destroy(_scene: Phaser.Scene): void {
    this.scoreText.destroy();
    this.fpsText.destroy();
    this.backArrow.destroy();
    this.dotBtn.destroy();
    this.scrollBtn.destroy();
    this.stopBtn.destroy();
    this.debugText.destroy();
  }
}
