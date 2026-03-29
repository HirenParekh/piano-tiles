/**
 * HoldTileTextures.ts
 *
 * Pre-bakes all shared canvas textures needed by HoldTileObject into Phaser's
 * texture cache. Called ONCE per scene (in PianoGameScene.create()) before any
 * tile objects are constructed.
 *
 * WHY pre-baking matters for performance:
 *   The previous approach drew shapes with Graphics objects (one per tile per frame).
 *   Here we draw into HTMLCanvasElements using the browser's native Canvas 2D API,
 *   then hand the pixel data to Phaser as static textures. The GPU receives each
 *   texture ONCE; all tiles that share the same width use the SAME GPU texture object,
 *   making their draw calls batch together — near-zero marginal cost per extra tile.
 *
 * TEXTURES CREATED (keyed by tile width where relevant):
 *   hold-body-{W}    — Dark-blue→black gradient body strip (W × 256px, scalable)
 *   hold-dome-{W}    — Blue dome arc cap (W × domeH px)
 *   hold-laser-{W}   — Cyan gradient laser strip (2px × 256px)
 *   hold-cap-{W}     — Cyan cap rectangle (W × CAP_HEIGHT px)
 *   hold-tapring-{W} — Glowing cyan circle outline at tile bottom; pre-tap indicator
 *   hold-dot         — Cyan filled circle for beat dots (10 × 10px)
 *   hold-ripple      — White stroke circle for sonar ripple (24 × 24px)
 *
 * All textures are checked via scene.textures.exists() before creation so that
 * scene rebuilds on resize do not re-upload textures already in the GPU cache.
 */

import Phaser from 'phaser';

// ---------------------------------------------------------------------------
// Color constants (CSS strings for the Canvas 2D API)
// ---------------------------------------------------------------------------

/** Top color of the tile body gradient (dark blue) */
const CSS_BODY_TOP = '#1565c0';
/** Mid color of the tile body gradient (used exactly at 1 slot's height from the bottom) */
const CSS_BODY_MID = '#0e3a6e';
/** Bottom color of the tile body gradient (black) */
const CSS_BODY_BOT = '#000000';
/** Fill bar and dome color (mid blue) */
const CSS_FILL     = '#308af1';
/** Cap, ring, and dot accent color (bright cyan) */
const CSS_CAP      = '#00cfff';
/** Ripple ring color (light blue-white) */
const CSS_RIPPLE   = '#a0e1ff';

// ---------------------------------------------------------------------------
// Geometry constants (must match values in HoldTileObject)
// ---------------------------------------------------------------------------

/** Height of the bottom cap rectangle; matches CAP_HEIGHT in HoldTileObject */
const CAP_HEIGHT = 20;

/**
 * Reference height for scalable gradient textures.
 * Actual tile bodies may be taller; scaleY stretches the gradient proportionally
 * — a linear gradient scaled vertically looks identical to one drawn at full height.
 */
const BAKE_HEIGHT = 256;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Bakes all shared hold-tile textures into the scene's texture cache.
 * Safe to call multiple times — skips any texture that already exists.
 *
 * @param scene     - The Phaser scene whose texture cache receives the textures.
 * @param laneWidth - Pixel width of a single lane (= screen width / LANE_COUNT).
 */
export function bakeHoldTileTextures(scene: Phaser.Scene, laneWidth: number): void {
  const visW = Math.round(laneWidth); // TILE_VISUAL_GAP is 0, so visW === laneWidth

  bakeBodyTop(scene, visW);
  bakeBodyBase(scene, visW);
  bakeDome(scene, visW);
  bakeLaser(scene, visW);
  bakeCap(scene, visW);
  bakeTapRing(scene, visW);
  bakeDot(scene);
  bakeRipple(scene);
}

/**
 * Returns the Phaser texture key for a hold-tile texture.
 * Centralised so HoldTileObject uses the exact same key without string math.
 *
 * @param name  - Base name, e.g. 'body', 'dome', 'ring'.
 * @param visW  - Optional visual width to include in the key (width-specific textures).
 */
export function holdTextureKey(name: string, visW?: number): string {
  return visW !== undefined ? `hold-${name}-${Math.round(visW)}` : `hold-${name}`;
}

// ---------------------------------------------------------------------------
// Private helpers — one function per texture
// ---------------------------------------------------------------------------

/**
 * Body gradient strip: dark-blue (top) → black (bottom).
 * Baked once per lane width at BAKE_HEIGHT (256px).
 * HoldTileObject scales it vertically to the gradient zone height only
 * (not the full tile height) — the fixed-pixel black zone at the bottom
 * is covered by a separate solid black Rectangle, avoiding any scaling seam.
 */
/**
 * Top body gradient: #1565c0 (top) → #0e3a6e (bottom).
 * Represents the upper portion of the tile, scaling dynamically to (tileHeight - singleTileH).
 */
function bakeBodyTop(scene: Phaser.Scene, visW: number): void {
  const key = holdTextureKey('body-top', visW);
  if (scene.textures.exists(key)) return;

  const tex = scene.textures.createCanvas(key, visW, BAKE_HEIGHT);
  if (!tex) return;

  const ctx  = tex.getContext();
  const grad = ctx.createLinearGradient(0, 0, 0, BAKE_HEIGHT);
  grad.addColorStop(0, CSS_BODY_TOP);
  grad.addColorStop(1, CSS_BODY_MID);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, visW, BAKE_HEIGHT);
  tex.refresh();
}

/**
 * Base body gradient: #0e3a6e (top) → #000000 (bottom), with the bottom 40% solid black.
 * Represents the bottom single-slot portion of the hold tile, scaled exactly to singleTileH.
 */
function bakeBodyBase(scene: Phaser.Scene, visW: number): void {
  const key = holdTextureKey('body-base', visW);
  if (scene.textures.exists(key)) return;

  const tex = scene.textures.createCanvas(key, visW, BAKE_HEIGHT);
  if (!tex) return;

  const ctx  = tex.getContext();
  const grad = ctx.createLinearGradient(0, 0, 0, BAKE_HEIGHT);
  // Canvas Y grows downwards: 0 is top, BAKE_HEIGHT is bottom.
  // The CSS gradient hits solid black at 40% from the bottom.
  // Therefore, solid black starts at gradient stop 0.6.
  grad.addColorStop(0, CSS_BODY_MID);
  grad.addColorStop(0.6, CSS_BODY_BOT);
  grad.addColorStop(1, CSS_BODY_BOT);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, visW, BAKE_HEIGHT);
  tex.refresh();
}

/**
 * Dome arc cap: the blue rounded dome sitting on top of the fill bar.
 *
 * Geometry: a circular arc of radius R = visW, spanning ±60° from vertical.
 *   domeDy     = visW × sin(60°) ≈ visW × 0.866  (chord-to-center distance)
 *   domeHeight = visW − domeDy                    (pixels above the chord)
 *
 * Canvas coordinate system:
 *   y = 0         → apex (plus 2px anti-aliasing buffer at top)
 *   y = domeRTH-1 → chord line (aligns with fill bar top)
 *   circle center → below the canvas bottom (clipped naturally by the canvas)
 */
function bakeDome(scene: Phaser.Scene, visW: number): void {
  const key = holdTextureKey('dome', visW);
  if (scene.textures.exists(key)) return;

  const domeDy  = visW * 0.866025;          // sin(60°) = sqrt(3)/2
  const domeH   = visW - domeDy;            // pixels the dome protrudes above chord
  const canvasH = Math.ceil(domeH) + 2;     // +2px top buffer for anti-aliasing

  const tex = scene.textures.createCanvas(key, visW, canvasH);
  if (!tex) return;

  const ctx    = tex.getContext();
  const chordY = canvasH - 1;               // chord at the very bottom of the canvas
  const cx     = visW / 2;
  const cy     = chordY + domeDy;           // circle center — below canvas, pixels clipped

  ctx.fillStyle = CSS_FILL;
  ctx.beginPath();
  ctx.moveTo(0, chordY);                    // chord left corner
  ctx.lineTo(visW, chordY);                 // chord right corner
  // Arc from -60° to -120° anticlockwise (= upward dome in screen space).
  ctx.arc(cx, cy, visW, -Math.PI / 3, -2 * Math.PI / 3, true);
  ctx.closePath();
  ctx.fill();
  tex.refresh();
}

/**
 * Laser glow strip: a 2px-wide vertical cyan gradient for the tile center.
 * Baked tall so tiles can scaleY it to match the body height.
 * ADD blend mode is applied on the sprite in HoldTileObject, not in this texture.
 */
function bakeLaser(scene: Phaser.Scene, visW: number): void {
  const key = holdTextureKey('laser', visW);
  if (scene.textures.exists(key)) return;

  // 2px wide; the sprite is positioned at centerX-1 in HoldTileObject.
  const tex = scene.textures.createCanvas(key, 2, BAKE_HEIGHT);
  if (!tex) return;

  const ctx  = tex.getContext();
  const grad = ctx.createLinearGradient(0, 0, 0, BAKE_HEIGHT);
  grad.addColorStop(0,    'rgba(100, 200, 255, 0.30)'); // faint cyan at top
  grad.addColorStop(0.88, 'rgba(0,   200, 255, 0.0)');  // fade to transparent
  grad.addColorStop(1,    'rgba(0,   200, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, BAKE_HEIGHT);
  tex.refresh();
}

/**
 * Cap stripe: solid cyan bar at the tile's bottom (the tap-target visual indicator).
 * Width = visW, height = CAP_HEIGHT.
 */
function bakeCap(scene: Phaser.Scene, visW: number): void {
  const key = holdTextureKey('cap', visW);
  if (scene.textures.exists(key)) return;

  const tex = scene.textures.createCanvas(key, visW, CAP_HEIGHT);
  if (!tex) return;

  const ctx = tex.getContext();
  ctx.fillStyle = CSS_CAP;
  ctx.fillRect(0, 0, visW, CAP_HEIGHT);
  tex.refresh();
}

/**
 * Static tap-target ring: a simple, thin cyan circle outline matching the
 * original game's visual. Single stroke, no glow — just a clean ring.
 * Fixed at 26px diameter so it looks consistent regardless of lane width.
 */
function bakeTapRing(scene: Phaser.Scene, visW: number): void {
  const key = holdTextureKey('tapring', visW);
  if (scene.textures.exists(key)) return;

  const diameter = 26;              // fixed size matching the original game
  const padding  = 4;               // enough room so the stroke edge isn't clipped
  const size     = diameter + padding;
  const cx       = size / 2;
  const cy       = size / 2;
  const r        = diameter / 2;

  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return;

  const ctx = tex.getContext();

  // Single crisp outline — matches the original game exactly.
  ctx.strokeStyle = CSS_CAP; // #00cfff
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
  ctx.stroke();

  tex.refresh();
}



/**
 * Beat dot: small solid cyan circle placed at secondary beat positions inside the tile.
 * 10×10px circle. Pool sprites are positioned at the dot's world coordinates on tap.
 */
function bakeDot(scene: Phaser.Scene): void {
  const key = holdTextureKey('dot');
  if (scene.textures.exists(key)) return;

  const size = 10;
  const tex  = scene.textures.createCanvas(key, size, size);
  if (!tex) return;

  const ctx = tex.getContext();
  ctx.fillStyle = CSS_CAP;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  tex.refresh();
}

/**
 * Sonar ripple: a light-blue stroke circle for the beat-crossing ripple effect.
 * 24×24px; the pool sprite tweens scale 1 → 6 then returns to the pool.
 */
function bakeRipple(scene: Phaser.Scene): void {
  const key = holdTextureKey('ripple');
  if (scene.textures.exists(key)) return;

  const size = 24;
  const tex  = scene.textures.createCanvas(key, size, size);
  if (!tex) return;

  const ctx = tex.getContext();
  ctx.strokeStyle = CSS_RIPPLE;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.stroke();
  tex.refresh();
}
