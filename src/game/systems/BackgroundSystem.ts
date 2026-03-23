/**
 * BackgroundSystem.ts
 *
 * Renders the animated visual background for the Phaser game board,
 * matching the aesthetic of GameBoardClassicSkin.tsx / _game-board-classic.scss.
 *
 * RESPONSIBILITY:
 *   - Draw and animate the shifting blue/purple/cyan gradient background.
 *   - Create bokeh circles (large semi-transparent ellipses) with slow pulsing tweens.
 *   - Emit floating particle bubbles that drift upward like the CSS particle layer.
 *
 * DOES NOT:
 *   - Know about tiles, audio, or scroll logic.
 *   - Need an update() call — all animation is driven by Phaser tweens and particles.
 *
 * LAYER DEPTHS (background is always below everything else):
 *   0  — gradient base layer
 *   1  — animated overlay rectangles (color-shifting effect)
 *   2  — bokeh circles
 *   3  — floating particles
 *   (Tiles are depth 10, HUD is depth 1000)
 *
 * WHY no per-frame Graphics redraws:
 *   Calling graphics.clear() + graphics.fillRect() every frame is expensive.
 *   Instead, the gradient is painted ONCE; color-shifting is achieved by
 *   tweening the alpha of overlay Rectangles. Tweens run on Phaser's internal
 *   timeline — no update() method needed in this class.
 *
 * WHY setScrollFactor(0) on every object:
 *   The camera scrolls the tile world upward as the song plays. Background
 *   elements must remain fixed on screen. scrollFactor(0) achieves this
 *   without needing a separate HUD camera.
 */

import Phaser from 'phaser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Depth values for each background layer.
 * All below tile depth (10) so tiles always render on top.
 */
const DEPTH_GRADIENT  = 0;
const DEPTH_OVERLAY   = 1;
const DEPTH_BOKEH     = 2;
const DEPTH_PARTICLES = 3;

/**
 * Gradient corner colors — matching the CSS linear-gradient:
 *   135deg, #4facfe 0%, #9b7fe8 25%, #00f2fe 50%, #a78bfa 75%, #4facfe 100%
 *
 * Phaser fillGradientStyle accepts 4 corner colors (tl, tr, bl, br).
 * We map the CSS diagonal to: top corners = early colors, bottom = later colors.
 */
const GRADIENT_TOP_LEFT     = 0x4facfe; // sky blue
const GRADIENT_TOP_RIGHT    = 0x9b7fe8; // soft purple
const GRADIENT_BOTTOM_LEFT  = 0x00f2fe; // cyan
const GRADIENT_BOTTOM_RIGHT = 0xa78bfa; // violet

/**
 * Animated overlay colors.
 * These rectangles fade in and out to create the shifting hue animation,
 * equivalent to the CSS classicBgShift keyframe animating background-position.
 */
const OVERLAYS: { color: number; maxAlpha: number; duration: number; delay: number }[] = [
  { color: 0x9b7fe8, maxAlpha: 0.50, duration: 5000, delay:    0 }, // purple wave
  { color: 0x00f2fe, maxAlpha: 0.40, duration: 7000, delay: 2500 }, // cyan wash
  { color: 0x4facfe, maxAlpha: 0.35, duration: 6000, delay: 4000 }, // blue pulse
];

/**
 * Bokeh circle definitions — matching the large blurred circles in the CSS skin.
 *
 * Positions are ratios [0..1] of screen width/height so they scale on resize.
 * In Phaser we can't CSS-blur, so we approximate by drawing 3 concentric ellipses
 * at increasing size + decreasing alpha — this softens the edge like a blur.
 *
 * `floatRange` is the pixel distance the circle drifts vertically (bokehFloat).
 * `driftXRange` adds a horizontal component for diagonal drift (bokehDrift).
 */
const BOKEH_CIRCLES: {
  xRatio: number; yRatio: number; radius: number;
  color: number; alpha: number;
  duration: number; delay: number;
  driftXRange: number; floatRange: number;
}[] = [
  { xRatio: 0.05,  yRatio: 0.10, radius: 150, color: 0x64b4ff, alpha: 0.60, duration: 14000, delay:  0, driftXRange:   0, floatRange:  20 },
  { xRatio: 0.65,  yRatio: 0.05, radius: 110, color: 0xbe82ff, alpha: 0.55, duration: 18000, delay:  3, driftXRange:  15, floatRange:  15 },
  { xRatio: 0.30,  yRatio: 0.45, radius: 160, color: 0x32d2ff, alpha: 0.50, duration: 22000, delay:  7, driftXRange:   0, floatRange:  25 },
  { xRatio: 0.82,  yRatio: 0.60, radius:  90, color: 0xd296ff, alpha: 0.55, duration: 16000, delay:  5, driftXRange: -12, floatRange:  18 },
  { xRatio: 0.12,  yRatio: 0.70, radius: 130, color: 0x50c8ff, alpha: 0.50, duration: 20000, delay:  9, driftXRange:   0, floatRange:  22 },
  { xRatio: 0.50,  yRatio: 0.00, radius: 100, color: 0x82f0ff, alpha: 0.45, duration: 25000, delay: 11, driftXRange:  10, floatRange:  12 },
];

/** Texture key used for particle circles. Created once in the texture cache. */
const PARTICLE_TEXTURE_KEY = 'bg-particle-circle';

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class BackgroundSystem {
  /** All game objects owned by this system, collected for bulk destroy(). */
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  /**
   * @param scene - The owning Phaser scene.
   */
  constructor(scene: Phaser.Scene) {
    this.createGradient(scene);
    this.createBokeh(scene);
    this.createParticles(scene);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Destroys all game objects owned by this system.
   * Call this before recreating BackgroundSystem on resize.
   */
  destroy(): void {
    this.objects.forEach((obj) => obj.destroy());
    this.objects.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Private: gradient layer
  // ---------------------------------------------------------------------------

  /**
   * Paints a static diagonal gradient base, then adds alpha-tweened overlay
   * Rectangles that cross-fade to simulate the animated CSS background-position shift.
   */
  private createGradient(scene: Phaser.Scene): void {
    const { width, height } = scene.scale;

    // ── Static gradient base ─────────────────────────────────────────────────
    // Graphics.fillGradientStyle fills a rect with up to 4 corner colors using
    // WebGL linear interpolation — no shader needed.
    const base = scene.add.graphics();
    base.fillGradientStyle(
      GRADIENT_TOP_LEFT, GRADIENT_TOP_RIGHT,
      GRADIENT_BOTTOM_LEFT, GRADIENT_BOTTOM_RIGHT,
      1,
    );
    base.fillRect(0, 0, width, height);
    base.setScrollFactor(0);
    base.setDepth(DEPTH_GRADIENT);
    this.objects.push(base);

    // ── Animated overlay rectangles ──────────────────────────────────────────
    // Each rectangle starts at alpha 0 and tweens to maxAlpha then back (yoyo).
    // Staggered delays ensure they're out of phase, creating the hue-sweep effect.
    for (const overlay of OVERLAYS) {
      const rect = scene.add.rectangle(0, 0, width, height, overlay.color, 0);
      rect.setOrigin(0, 0);
      rect.setScrollFactor(0);
      rect.setDepth(DEPTH_OVERLAY);
      this.objects.push(rect);

      scene.tweens.add({
        targets: rect,
        alpha: overlay.maxAlpha,
        duration: overlay.duration,
        delay: overlay.delay,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // ── Radial glow overlay ──────────────────────────────────────────────────
    // A soft white ellipse centered on screen that slowly pulses, matching the
    // CSS __bg-glow layer. Approximated as a white rectangle with low alpha + tween.
    const glow = scene.add.graphics();
    glow.fillStyle(0xffffff, 0.10);
    glow.fillEllipse(width / 2, height * 0.6, width * 0.70, height * 0.50);
    glow.setScrollFactor(0);
    glow.setDepth(DEPTH_OVERLAY);
    this.objects.push(glow);

    scene.tweens.add({
      targets: glow,
      alpha: { from: 0.6, to: 1.0 },
      duration: 5000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // ---------------------------------------------------------------------------
  // Private: bokeh circles
  // ---------------------------------------------------------------------------

  /**
   * Creates large semi-transparent ellipses that slowly float and pulse,
   * matching the CSS bokeh-circle elements.
   *
   * WHY layered concentric ellipses instead of CSS blur():
   *   Phaser doesn't expose CSS filter:blur() on individual game objects (WebGL
   *   pipelines would be needed). Drawing 3 concentric ellipses — large/dim,
   *   medium/medium, small/bright — approximates the soft-edge "blur" look
   *   cheaply without any shader work.
   */
  private createBokeh(scene: Phaser.Scene): void {
    const { width, height } = scene.scale;

    for (const def of BOKEH_CIRCLES) {
      const cx = def.xRatio * width;
      const cy = def.yRatio * height;

      // Draw 3 concentric layers to simulate the CSS blur effect.
      // Outer layer: largest, most transparent
      // Inner layer: smallest, most opaque
      const layers: { radiusScale: number; alphaScale: number }[] = [
        { radiusScale: 1.5, alphaScale: 0.25 },
        { radiusScale: 1.2, alphaScale: 0.50 },
        { radiusScale: 1.0, alphaScale: 0.80 },
      ];

      const layerObjects: Phaser.GameObjects.Ellipse[] = [];

      for (const layer of layers) {
        const r = def.radius * layer.radiusScale;
        const ellipse = scene.add.ellipse(cx, cy, r * 2, r * 2, def.color);
        ellipse.setAlpha(def.alpha * layer.alphaScale);
        ellipse.setScrollFactor(0);
        ellipse.setDepth(DEPTH_BOKEH);
        this.objects.push(ellipse);
        layerObjects.push(ellipse);
      }

      // Pulse alpha tween — all 3 layers pulse together
      scene.tweens.add({
        targets: layerObjects,
        alpha: { from: def.alpha * 0.5, to: def.alpha },
        duration: def.duration,
        delay: def.delay * 1000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      // Float / drift tween — the whole group drifts vertically (± horizontal)
      for (const ellipse of layerObjects) {
        scene.tweens.add({
          targets: ellipse,
          y: ellipse.y + def.floatRange,
          x: def.driftXRange !== 0 ? ellipse.x + def.driftXRange : ellipse.x,
          duration: def.duration * 0.8,
          delay: def.delay * 500,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: floating particles
  // ---------------------------------------------------------------------------

  /**
   * Creates a particle emitter that continuously spawns small white-blue circles
   * that drift upward — matching the CSS __particle / particleRise animation.
   *
   * WHY generate texture at runtime:
   *   We have no external assets at this stage. `scene.make.graphics()` draws a
   *   circle into a RenderTexture and saves it under PARTICLE_TEXTURE_KEY so the
   *   particle emitter can reference it. The texture is created once and reused
   *   on subsequent BackgroundSystem instances after resize.
   */
  private createParticles(scene: Phaser.Scene): void {
    const { width, height } = scene.scale;

    // Generate particle texture only on first use — it's the same circle every time.
    if (!scene.textures.exists(PARTICLE_TEXTURE_KEY)) {
      const gfx = scene.make.graphics({}, false);
      gfx.fillStyle(0xdce8ff, 1); // light blue-white
      gfx.fillCircle(8, 8, 8);
      gfx.generateTexture(PARTICLE_TEXTURE_KEY, 16, 16);
      gfx.destroy();
    }

    // Emitter positioned at the bottom of the screen; particles rise upward.
    const emitter = scene.add.particles(0, height, PARTICLE_TEXTURE_KEY, {
      // Spread particles horizontally across the full screen width.
      x: { min: 0, max: width },
      // Start from the bottom edge.
      y: { min: height - 5, max: height + 5 },
      // Upward movement — negative Y is upward in Phaser's coordinate system.
      speedY: { min: -80, max: -30 },
      // Slight horizontal drift for organic feel.
      speedX: { min: -8, max: 8 },
      // Particles shrink as they rise, fading out like the CSS animation.
      scale: { start: 0.6, end: 0.05 },
      alpha: { start: 0.50, end: 0 },
      // Long lifespan so particles travel most of the screen before dying.
      lifespan: { min: 7000, max: 15000 },
      // Emit one particle every 600ms — matches the CSS 18-particle stagger.
      frequency: 600,
      quantity: 1,
    });

    emitter.setScrollFactor(0);
    emitter.setDepth(DEPTH_PARTICLES);
    this.objects.push(emitter);
  }
}
