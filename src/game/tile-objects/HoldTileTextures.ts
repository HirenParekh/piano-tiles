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

/**
 * Configuration object for hold tile fill colors.
 * Exported so the FX Sandbox can modify these values for live tuning.
 */
export const HOLD_TILE_COLORS = {
  bulletTop: '#6bdcfa',
  bulletBot: '#60c4f8',
  fillTop:   '#60c4f8',
  fillBot:   '#50bcfa',
  bulletStop: 0.47,
  fillStart:  0.70,
  fillStop:   1.00,
  bulletTailH: 100,
  glowColor: '#3af4fc',
  showGlow:  false
};

/** Secondary accent for UI elements (caps/rings) */
const CSS_UI_ACCENT  = '#00cfff';

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
export const BAKE_HEIGHT = 256;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Bakes all shared hold-tile textures into the scene's texture cache.
 *
 * @param scene     - The Phaser scene whose texture cache receives the textures.
 * @param laneWidth - Pixel width of a single lane (= screen width / LANE_COUNT).
 * @param force     - If true, overwrites existing textures (used for live tuning).
 */
export function bakeHoldTileTextures(scene: Phaser.Scene, laneWidth: number, force = false): void {
  const visW = Math.round(laneWidth);

  bakeBodyTop(scene, visW, force);
  bakeBodyBase(scene, visW, force);
  bakeBullet(scene, visW, force);
  bakeFillBar(scene, visW, force);
  bakeLaser(scene, visW, force);
  bakeCap(scene, visW, force);
  bakeTapRing(scene, visW, force);
  bakeDot(scene, force);
  bakeRipple(scene, force);
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
function bakeBodyTop(scene: Phaser.Scene, visW: number, force = false): void {
  const key = holdTextureKey('body-top', visW);
  if (!force && scene.textures.exists(key)) return;

  const tex = scene.textures.exists(key) 
    ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) 
    : scene.textures.createCanvas(key, visW, BAKE_HEIGHT);

  if (!tex) return;

  const ctx  = tex.getContext();
  ctx.clearRect(0, 0, visW, BAKE_HEIGHT);
  const grad = ctx.createLinearGradient(0, 0, 0, BAKE_HEIGHT);
  grad.addColorStop(0, '#1565c0');
  grad.addColorStop(1, '#0e3a6e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, visW, BAKE_HEIGHT);
  tex.refresh();
}

function bakeBodyBase(scene: Phaser.Scene, visW: number, force = false): void {
  const key = holdTextureKey('body-base', visW);
  if (!force && scene.textures.exists(key)) return;

  const tex = scene.textures.exists(key) 
    ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) 
    : scene.textures.createCanvas(key, visW, BAKE_HEIGHT);

  if (!tex) return;

  const ctx  = tex.getContext();
  ctx.clearRect(0, 0, visW, BAKE_HEIGHT);
  const grad = ctx.createLinearGradient(0, 0, 0, BAKE_HEIGHT);
  grad.addColorStop(0, '#0e3a6e');
  grad.addColorStop(0.6, '#000000');
  grad.addColorStop(1, '#000000');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, visW, BAKE_HEIGHT);
  tex.refresh();
}

/**
 * Bullet arc cap: the blue rounded dome sitting on top of the fill bar with a 100px tail.
 * Enhanced with internal gradients and a glowing boundary.
 */
function bakeBullet(scene: Phaser.Scene, visW: number, force = false): void {
  const key = holdTextureKey('bullet', visW);
  if (!force && scene.textures.exists(key)) return;

  const domeDy  = visW * 0.866025;          // sin(60°) = sqrt(3)/2
  const domeH   = visW - domeDy;            // pixels the dome protrudes above chord
  const tailH   = HOLD_TILE_COLORS.bulletTailH;
  const baseCanvasH = Math.ceil(domeH) + 2; // +2px top buffer for anti-aliasing
  const canvasH = baseCanvasH + tailH;

  const tex = scene.textures.exists(key) 
    ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) 
    : scene.textures.createCanvas(key, visW, canvasH);

  if (!tex) return;

  const ctx    = tex.getContext();
  ctx.clearRect(0, 0, visW, canvasH); // IMPORTANT: fresh start for re-bakes
  const chordY = baseCanvasH - 1;           // chord at the bottom of the original dome area
  const cx     = visW / 2;
  const cy     = chordY + domeDy;           // circle center — below chord

  // 1. Fill with the premium vertical gradient
  const grad = ctx.createLinearGradient(0, 0, 0, canvasH);
  // User-tunable stop position (default: 0.5 for a '50-50' split)
  const stopPos = HOLD_TILE_COLORS.bulletStop;
  grad.addColorStop(0, HOLD_TILE_COLORS.bulletTop);
  grad.addColorStop(stopPos, HOLD_TILE_COLORS.bulletBot);
  grad.addColorStop(1, HOLD_TILE_COLORS.bulletBot);
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(0, chordY);                    // chord left corner
  ctx.lineTo(visW, chordY);                 // chord right corner
  // Arc from -60° to -120° anticlockwise (= upward dome in screen space).
  ctx.arc(cx, cy, visW, -Math.PI / 3, -2 * Math.PI / 3, true);
  ctx.closePath();
  ctx.fill();

  // Draw the 100px bullet tail dead flush underneath the chord.
  ctx.fillRect(0, chordY, visW, tailH);

  // 2. Add the sharp arc border (stroke) — no glow by default
  ctx.strokeStyle = HOLD_TILE_COLORS.glowColor;
  ctx.lineWidth   = 1.5;
  // Explicitly disable shadows to ensure no unwanted glow effects
  ctx.shadowBlur  = HOLD_TILE_COLORS.showGlow ? 16 : 0;
  ctx.shadowColor = HOLD_TILE_COLORS.glowColor;
  
  ctx.beginPath();
  ctx.arc(cx, cy, visW - 1, -Math.PI / 3, -2 * Math.PI / 3, true);
  ctx.stroke();

  tex.refresh();
}

function bakeFillBar(scene: Phaser.Scene, visW: number, force = false): void {
  const key = holdTextureKey('fill-bar', visW);
  if (!force && scene.textures.exists(key)) return;

  const tex = scene.textures.exists(key) 
    ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) 
    : scene.textures.createCanvas(key, visW, BAKE_HEIGHT);

  if (!tex) return;

  const ctx  = tex.getContext();
  ctx.clearRect(0, 0, visW, BAKE_HEIGHT);
  const grad = ctx.createLinearGradient(0, 0, 0, BAKE_HEIGHT);
  const startPos = HOLD_TILE_COLORS.fillStart;
  const stopPos  = HOLD_TILE_COLORS.fillStop;
  grad.addColorStop(0,        HOLD_TILE_COLORS.fillTop); 
  grad.addColorStop(startPos, HOLD_TILE_COLORS.fillTop); 
  grad.addColorStop(stopPos,  HOLD_TILE_COLORS.fillBot);
  grad.addColorStop(1,        HOLD_TILE_COLORS.fillBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, visW, BAKE_HEIGHT);
  tex.refresh();
}

/**
 * Laser glow strip: a 2px-wide vertical cyan gradient for the tile center.
 * Baked tall so tiles can scaleY it to match the body height.
 * ADD blend mode is applied on the sprite in HoldTileObject, not in this texture.
 */
function bakeLaser(scene: Phaser.Scene, visW: number, force = false): void {
  const key = holdTextureKey('laser', visW);
  if (!force && scene.textures.exists(key)) return;

  const tex = scene.textures.exists(key) 
    ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) 
    : scene.textures.createCanvas(key, 2, BAKE_HEIGHT);

  if (!tex) return;

  const ctx  = tex.getContext();
  ctx.clearRect(0, 0, 2, BAKE_HEIGHT);
  const grad = ctx.createLinearGradient(0, 0, 0, BAKE_HEIGHT);
  grad.addColorStop(0,    'rgba(100, 200, 255, 0.30)'); // faint cyan at top
  grad.addColorStop(0.88, 'rgba(0,   200, 255, 0.0)');  // fade to transparent
  grad.addColorStop(1,    'rgba(0,   200, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, BAKE_HEIGHT);
  tex.refresh();
}

function bakeCap(scene: Phaser.Scene, visW: number, force = false): void {
  const key = holdTextureKey('cap', visW);
  if (!force && scene.textures.exists(key)) return;

  const tex = scene.textures.exists(key) 
    ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) 
    : scene.textures.createCanvas(key, visW, CAP_HEIGHT);

  if (!tex) return;

  const ctx = tex.getContext();
  ctx.clearRect(0, 0, visW, CAP_HEIGHT);
  ctx.fillStyle = CSS_UI_ACCENT;
  ctx.fillRect(0, 0, visW, CAP_HEIGHT);
  tex.refresh();
}

function bakeTapRing(scene: Phaser.Scene, visW: number, force = false): void {
  const key = holdTextureKey('tapring', visW);
  if (!force && scene.textures.exists(key)) return;

  const diameter = 26;              // fixed size matching the original game
  const padding  = 4;               // enough room so the stroke edge isn't clipped
  const size     = diameter + padding;
  const cx       = size / 2;
  const cy       = size / 2;
  const r        = diameter / 2;

  const tex = scene.textures.exists(key) 
    ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) 
    : scene.textures.createCanvas(key, size, size);

  if (!tex) return;

  const ctx = tex.getContext();
  ctx.clearRect(0, 0, size, size);

  // Single crisp outline — matches the original game exactly.
  ctx.strokeStyle = CSS_UI_ACCENT; // #00cfff
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
function bakeDot(scene: Phaser.Scene, force = false): void {
  const key = holdTextureKey('dot');
  if (!force && scene.textures.exists(key)) return;

  const size = 10;
  const tex = scene.textures.exists(key) 
    ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) 
    : scene.textures.createCanvas(key, size, size);

  if (!tex) return;

  const ctx = tex.getContext();
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = CSS_UI_ACCENT;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  tex.refresh();
}

function bakeRipple(scene: Phaser.Scene, force = false): void {
  const key = holdTextureKey('ripple');
  if (!force && scene.textures.exists(key)) return;

  const size = 128; // high-res canvas
  const radius = 20; // larger base radius to capture more detail
  const tex = scene.textures.exists(key) 
    ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) 
    : scene.textures.createCanvas(key, size, size);

  if (!tex) return;

  const ctx = tex.getContext();
  ctx.clearRect(0, 0, size, size);

  // White core with a luxurious, feathered cyan glow
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 1.5;           // Hairline thickness
  ctx.shadowColor = HOLD_TILE_COLORS.glowColor;      // Bright Cyan
  ctx.shadowBlur  = 24;            // Soft, dreamy bloom (increased for high-res)

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  
  // Multiple strokes to build a vibrant, clear core without "fattening" the line
  ctx.stroke();
  ctx.stroke();

  tex.refresh();
}
