/**
 * PhaserGameBoard.tsx
 *
 * React shell that hosts the Phaser-rendered game board.
 *
 * RESPONSIBILITY:
 *   Bridge between App.tsx and the Phaser game engine:
 *   - Renders <PhaserGame> with PianoGameScene.
 *   - Listens for EXIT_GAME and calls onExit.
 *
 * DOES NOT:
 *   - Contain any game or audio logic.
 *   - Know about Phaser internals beyond the public scene API.
 *
 * AUDIO BRIDGE:
 *   useTileAudio expects a `Tile` (from track.ts) but Phaser emits a `GameTile`
 *   (from midi.ts). buildAudioTileMap() converts the song's GameTile[] into a
 *   Map<id, Tile> once at mount, so each TILE_TAPPED lookup is O(1).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MidiParseResult } from '../types/midi';
import { PhaserGame } from '../game/PhaserGame';
import type { IRefPhaserGame } from '../game/PhaserGame';
import { EventBus, PianoEvents } from '../game/EventBus';
import type { LoadSongPayload } from '../game/EventBus';
import { PianoGameScene } from '../game/scenes/PianoGameScene';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PhaserGameBoardProps {
  /** Full parse result for the selected song. */
  result: MidiParseResult;

  /** Called when the player taps the back button. Routes to App.tsx handleExitGame. */
  onExit: () => void;

  /** Playback speed multiplier (1.0 = normal, 0.5 = half speed). */
  speedMultiplier?: number;
  /** When true, note-name labels are rendered on every tile (debug skin). */
  debug?: boolean;
  /** Phaser timeScale to globally slow down all tweens, timers, and physics for debugging animations. */
  timeScale?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PhaserGameBoard({
  result,
  onExit,
  speedMultiplier = 1,
  debug = false,
  timeScale = 1,
}: PhaserGameBoardProps) {
  const phaserRef = useRef<IRefPhaserGame>(null);

  /**
   * Guards against calling scene.restart() more than once.
   * CURRENT_SCENE_READY fires on every scene transition; without this flag
   * the post-restart firing would trigger another restart → infinite loop.
   */
  const songSentRef = useRef(false);

  // audioTileMap no longer needed for audio: Phaser handles it internally.
  // We keep buildAudioTileMap in the codebase for now in case other UI needs it.

  // No longer needed: audio is handled internally by Phaser AudioSystem

  /** Song payload passed to PianoGameScene.init() via scene.scene.restart(). */
  const payload = useMemo<LoadSongPayload>(
    () => ({
      tiles: result.tiles,
      result,
      scrollSegments: result.info.scrollSegments ?? [],
      speedMultiplier,
      debug,
    }),
    [result, speedMultiplier, debug],
  );

  /**
   * Called by PhaserGame when any scene emits CURRENT_SCENE_READY.
   * On the first call (empty-boot scene), restart with the real song payload.
   */
  const handleSceneReady = useCallback(
    (scene: Phaser.Scene) => {
      scene.time.timeScale = timeScale; // Slows down scene timers
      scene.tweens.timeScale = timeScale; // Slows down our tap animation tweens!
      if (!songSentRef.current) {
        songSentRef.current = true;
        scene.scene.restart(payload as unknown as object);
      }
    },
    [payload, timeScale],
  );

  // Apply timeScale dynamically if it changes during gameplay
  useEffect(() => {
    if (phaserRef.current?.scene) {
      phaserRef.current.scene.time.timeScale = timeScale;
      phaserRef.current.scene.tweens.timeScale = timeScale;
    }
  }, [timeScale]);

  // ── EventBus listeners ────────────────────────────────────────────────────

  useEffect(() => {
    /** HUDSystem (Step 6) emits EXIT_GAME when the back button is tapped. */
    const handleExit = () => onExit();

    EventBus.on(PianoEvents.EXIT_GAME, handleExit);

    return () => {
      EventBus.off(PianoEvents.EXIT_GAME, handleExit);
    };
  }, [onExit]);
  // onPlayNote / onHoldRelease are accessed via refs, not listed as deps,
  // so the listeners aren't re-registered on every parent render.

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <PhaserGame
        ref={phaserRef}
        scenes={[PianoGameScene]}
        onSceneReady={handleSceneReady}
      />
    </div>
  );
}
