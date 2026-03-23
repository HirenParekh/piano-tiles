/**
 * SingleTileRippleAnimation.ts
 *
 * Implements the "rectangular ripple" tap animation for SingleTiles,
 * replicating the legacy CSS `rectTapDissolve` effect in Phaser geometry.
 *
 * SOLID Principles applied:
 * Single Responsibility Principle (SRP): This class solely handles the creation,
 * tweening, and cleanup of the visual ripple effect. `SingleTileObject` delegating
 * this logic here keeps its own class focused on core tile logic and state.
 */

import Phaser from 'phaser';

/**
 * Options for the ripple animation configuration.
 */
export interface RippleAnimationOptions {
  scene: Phaser.Scene;
  container: Phaser.GameObjects.Container;
  originRect: Phaser.GameObjects.Rectangle;
  width: number;
  height: number;
  color: number;
  duration?: number;
  onComplete?: () => void;
}

/**
 * Creates an exact math solver for CSS cubic-bezier(p1x, p1y, p2x, p2y).
 * This ensures our Phaser tween precisely matches the legacy CSS curve.
 */
function createCubicBezierSolver(p1x: number, p1y: number, p2x: number, p2y: number) {
  const cx = 3.0 * p1x;
  const bx = 3.0 * (p2x - p1x) - cx;
  const ax = 1.0 - cx - bx;
  
  const cy = 3.0 * p1y;
  const by = 3.0 * (p2y - p1y) - cy;
  const ay = 1.0 - cy - by;

  const sampleCurveX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleCurveY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleCurveDerivativeX = (t: number) => (3.0 * ax * t + 2.0 * bx) * t + cx;

  return function(x: number): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    // Newton-Raphson approximation
    let t = x;
    for (let i = 0; i < 8; i++) {
        const currentX = sampleCurveX(t) - x;
        if (Math.abs(currentX) < 1e-5) break;
        const dX = sampleCurveDerivativeX(t);
        if (Math.abs(dX) < 1e-6) break;
        t -= currentX / dX;
    }
    
    return sampleCurveY(t);
  };
}

// Instantiate the exact solver used in the original CSS: cubic-bezier(0.05, 0.9, 0.3, 1.0)
const legacyRippleEase = createCubicBezierSolver(0.05, 0.9, 0.3, 1.0);

export class SingleTileRippleAnimation {
  /**
   * Plays the rectangular expanding ripple animation.
   * 
   * HOW IT WORKS:
   * To achieve the classic "expanding transparent hole" ripple effect, we use a 
   * Phaser GeometryMask perfectly fitted to the tile boundaries (overflow hidden).
   * 
   * Then, a single thick-bordered rectangle is scaled upwards.
   * As it scales, its inner transparent hole grows until it fully overtakes the tile.
   * The outer bounds geometrically overflow, but are perfectly clipped away by the mask.
   */
  public static play(options: RippleAnimationOptions): void {
    const {
      scene,
      container,
      originRect,
      width,
      height,
      color,
      duration = 180,
      onComplete
    } = options;

    // Make the original tile mostly transparent
    originRect.setAlpha(0.15);

    const cx = originRect.x;
    const cy = originRect.y;

    // Use a single Graphics object. By drawing 4 carefully sized margins,
    // we flawlessly replicate the visual of a "scaled thick stroke with overflow: hidden"
    // WITHOUT using WebGL GeometryMasks, which frequently break inside scrolling containers!
    const graphics = scene.add.graphics();
    container.add(graphics);

    // holeProgress: 0.75 means the inner cavity starts at 75% of the tile size
    const tweenTarget = { holeProgress: 0.75 };

    const updateGeometry = () => {
        graphics.clear();
        const progress = tweenTarget.holeProgress;
        
        // Dimensions of the transparent inner cavity
        const holeW = width * progress;
        const holeH = height * progress;
        
        // The thickness of the physical borders rendered
        const borderW = (width - holeW) / 2;
        const borderH = (height - holeH) / 2;

        const leftX = cx - width / 2;
        const topY = cy - height / 2;

        // Keep the stroke perfectly solid black (no fade) per request
        graphics.fillStyle(color, 1.0); 

        // Draw ONLY the 4 outer margins perfectly bounded inside the tile dimensions.
        // This is mathematically identical to drawing a massive scaled stroke with overflow: hidden!
        // Top edge
        if (borderH > 0) graphics.fillRect(leftX, topY, width, borderH);
        // Bottom edge
        if (borderH > 0) graphics.fillRect(leftX, topY + height - borderH, width, borderH);
        // Left edge (between top and bottom)
        if (borderW > 0) graphics.fillRect(leftX, topY + borderH, borderW, holeH);
        // Right edge (between top and bottom)
        if (borderW > 0) graphics.fillRect(cx + width / 2 - borderW, topY + borderH, borderW, holeH);
    };

    updateGeometry();

    scene.tweens.add({
      targets: tweenTarget,
      holeProgress: 1.0,  // Scale hole continuously up to 100% of tile size
      duration: duration,
      ease: legacyRippleEase, // Apply our precise, custom CSS cubic-bezier!
      onUpdate: updateGeometry,
      onComplete: () => {
        graphics.destroy();
        if (onComplete) onComplete();
      }
    });
  }
}
