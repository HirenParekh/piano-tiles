/**
 * PhaserGame.tsx
 *
 * React wrapper component that owns the Phaser.Game lifecycle.
 *
 * RESPONSIBILITIES (Single Responsibility):
 *   1. Mount a container <div> that Phaser will render its canvas into.
 *   2. Initialize the Phaser.Game instance exactly once on mount.
 *   3. Destroy the Phaser.Game instance on unmount (prevents WebGL leaks).
 *   4. Expose the active Phaser.Game and current Phaser.Scene to the parent
 *      via a React ref (IRefPhaserGame).
 *   5. Listen for the 'current-scene-ready' EventBus event so the ref stays
 *      up-to-date whenever the active scene changes.
 *
 * DOES NOT:
 *   - Own any game logic.
 *   - Know about tiles, audio, or scoring.
 *   - Re-render on game state changes (Phaser manages its own render loop).
 *
 * WHY useLayoutEffect (not useEffect):
 *   Phaser needs the DOM node to exist before it can mount its canvas.
 *   useLayoutEffect fires synchronously after the DOM is painted, guaranteeing
 *   the container div is present when new Phaser.Game() is called.
 *   useEffect fires asynchronously and can miss the first paint cycle.
 *
 * WHY forwardRef:
 *   Parent components (PhaserGameBoard.tsx) need imperative access to the
 *   active Phaser scene to call methods like `scene.startSong()`. forwardRef
 *   exposes this without requiring prop drilling or global state.
 */

import Phaser from 'phaser';
import { forwardRef, useEffect, useLayoutEffect, useRef } from 'react';
import { buildGameConfig } from './GameConfig';
import { EventBus, PianoEvents } from './EventBus';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The shape of the ref exposed to parent components.
 * Parents can read `game` to access Phaser internals (e.g. textures) and
 * `scene` to call methods on the currently active scene.
 */
export interface IRefPhaserGame {
  /** The Phaser.Game instance. Null before mount and after unmount. */
  game: Phaser.Game | null;
  /** The currently active Phaser.Scene. Null until the first scene is ready. */
  scene: Phaser.Scene | null;
}

/** Props accepted by PhaserGame. */
interface PhaserGameProps {
  /**
   * Ordered list of Phaser scene classes to register with the game.
   * The first scene in the array is started automatically on boot.
   */
  scenes: Phaser.Types.Scenes.SceneType[];

  /**
   * Optional callback fired whenever the active scene changes.
   * Useful for React to update its own state based on scene transitions
   * (e.g. showing/hiding React UI layers).
   *
   * @param scene - The newly active Phaser.Scene instance.
   */
  onSceneReady?: (scene: Phaser.Scene) => void;
}

// DOM element id for the Phaser canvas container.
// Must be unique on the page. Kept as a constant to avoid typos.
const PHASER_CONTAINER_ID = 'piano-phaser-container';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * PhaserGame
 *
 * Drop-in React component that hosts a Phaser game.
 * Render it anywhere in the React tree; it fills its parent's dimensions.
 *
 * @example
 * ```tsx
 * const phaserRef = useRef<IRefPhaserGame>(null);
 *
 * return (
 *   <PhaserGame
 *     ref={phaserRef}
 *     scenes={[PianoGameScene]}
 *     onSceneReady={(scene) => console.log('Active scene:', scene.scene.key)}
 *   />
 * );
 * ```
 */
export const PhaserGame = forwardRef<IRefPhaserGame, PhaserGameProps>(
  function PhaserGame({ scenes, onSceneReady }, ref) {
    // Internal ref to the Phaser.Game instance.
    // We use a ref (not state) because changing it must NOT trigger a re-render.
    const gameRef = useRef<Phaser.Game | null>(null);

    // -------------------------------------------------------------------------
    // Initialize Phaser once, synchronously after the DOM is ready.
    // -------------------------------------------------------------------------
    useLayoutEffect(() => {
      // Guard: only create the game once. React Strict Mode runs effects twice
      // in development, so this check prevents a duplicate game instance.
      if (gameRef.current !== null) return;

      const config = buildGameConfig(PHASER_CONTAINER_ID, scenes);
      gameRef.current = new Phaser.Game(config);

      // Expose the game instance to the parent immediately.
      // The scene will be set once CURRENT_SCENE_READY fires (see below).
      if (ref && typeof ref === 'object') {
        ref.current = { game: gameRef.current, scene: null };
      }

      // Cleanup: destroy the Phaser game when this component unmounts.
      // `removeCanvas: true` tells Phaser to remove the canvas DOM node too.
      return () => {
        if (gameRef.current) {
          gameRef.current.destroy(true);
          gameRef.current = null;
        }
        // Clear the ref so the parent doesn't hold a stale game reference.
        if (ref && typeof ref === 'object') {
          ref.current = { game: null, scene: null };
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
      // `scenes` and `ref` are intentionally excluded: changing them after
      // mount would require a full game restart (out of scope for this step).
    }, []);

    // -------------------------------------------------------------------------
    // Track the active scene via EventBus.
    // -------------------------------------------------------------------------
    useEffect(() => {
      /**
       * Each Phaser scene emits CURRENT_SCENE_READY at the end of its
       * create() method. We use this to keep the forwarded ref current
       * and to notify the parent via onSceneReady.
       */
      const handleSceneReady = (scene: Phaser.Scene) => {
        // Update the forwarded ref with the new active scene.
        if (ref && typeof ref === 'object' && ref.current) {
          ref.current.scene = scene;
        }

        // Notify the parent component (optional).
        onSceneReady?.(scene);
      };

      EventBus.on(PianoEvents.CURRENT_SCENE_READY, handleSceneReady);

      return () => {
        // Remove the specific listener to avoid memory leaks.
        // Using `off` with the handler reference removes only this listener,
        // not all listeners on CURRENT_SCENE_READY (other components may subscribe).
        EventBus.off(PianoEvents.CURRENT_SCENE_READY, handleSceneReady);
      };
    }, [onSceneReady, ref]);

    // -------------------------------------------------------------------------
    // Render: just a container div.
    // -------------------------------------------------------------------------
    // Phaser appends its <canvas> element as a child of this div.
    // `style` ensures the div (and thus the canvas) fills the parent.
    return (
      <div
        id={PHASER_CONTAINER_ID}
        style={{ width: '100%', height: '100%' }}
      />
    );
  },
);
