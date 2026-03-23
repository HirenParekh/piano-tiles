/**
 * GameConfig.ts
 *
 * Centralizes Phaser's game configuration and exports a factory function
 * for creating the Phaser.Game instance.
 *
 * WHY a factory function instead of a plain config object:
 *   The scene list is only known at runtime (after imports are resolved),
 *   and the `parent` container ID is determined by PhaserGame.tsx.
 *   Injecting both via `buildGameConfig()` keeps this file free of
 *   concrete scene imports, following the Dependency Inversion principle.
 *
 * KEY DECISIONS:
 *
 * - `type: Phaser.AUTO`
 *     Attempts WebGL first, falls back to Canvas. WebGL is required for
 *     the particle/glow effects planned for the Classic skin.
 *
 * - `scale.mode: Phaser.Scale.RESIZE`
 *     The canvas automatically resizes to fill its CSS container div.
 *     This replaces the ResizeObserver in the old useGameBoardEngine hook
 *     and lets us compute `scaleRatio` from `game.scale.height`.
 *
 * - `backgroundColor: '#000000'`
 *     Solid black fallback before BackgroundSystem draws its gradient.
 *     Once BackgroundSystem is active (Step 6) this won't be visible.
 *
 * - `transparent: false`
 *     We use Phaser-native backgrounds rather than letting the React DOM
 *     show through. Transparency incurs a compositing cost on mobile.
 *
 * - `roundPixels: true`
 *     Prevents sub-pixel rendering artifacts on tile edges.
 *
 * - `disableContextMenu: true`
 *     Prevents the browser right-click menu on long-press (important for
 *     mobile play).
 */

import Phaser from 'phaser';

/**
 * Builds the Phaser game configuration.
 *
 * @param parent  - The DOM element ID that will contain the Phaser canvas.
 *                  Must match the `id` prop on the div in PhaserGame.tsx.
 * @param scenes  - The ordered list of Phaser scenes to register.
 *                  Scenes are started by key, not by position, so order
 *                  only matters for the initial boot scene (index 0).
 * @returns A fully configured Phaser.Types.Core.GameConfig object.
 */
export function buildGameConfig(
  parent: string,
  scenes: Phaser.Types.Scenes.SceneType[],
): Phaser.Types.Core.GameConfig {
  return {
    // Use WebGL where available; fall back to Canvas for older devices.
    type: Phaser.AUTO,

    // The canvas will fill whatever CSS dimensions its container div has.
    // React controls the container size via CSS; Phaser just follows.
    parent,

    scale: {
      // RESIZE mode: Phaser automatically adjusts its internal resolution
      // whenever the browser window or container changes size.
      mode: Phaser.Scale.RESIZE,

      // Fill the parent container completely.
      width: '100%',
      height: '100%',
    },

    backgroundColor: '#000000',

    // Sub-pixel positioning causes blurry tile edges on Retina displays.
    roundPixels: true,

    // Suppress the context menu on right-click / long-press.
    disableContextMenu: true,

    // Scenes registered here are accessible by their string key anywhere
    // in the app via `this.scene.start('SceneKey')`.
    scene: scenes as Phaser.Scene[],
  };
}
