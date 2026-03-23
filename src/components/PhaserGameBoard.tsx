/**
 * PhaserGameBoard.tsx
 *
 * React shell that hosts the Phaser-rendered game board.
 *
 * RESPONSIBILITY:
 *   Bridge between App.tsx and the Phaser game engine:
 *   - Renders <PhaserGame> with PianoGameScene.
 *   - Waits for CURRENT_SCENE_READY, then restarts the scene with song data.
 *   - Listens for TILE_TAPPED / HOLD_RELEASED on the EventBus and forwards
 *     them to the React audio callbacks (useTileAudio).
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
import type { MidiParseResult, ParsedNote } from '../types/midi';
import type { Tile } from '../types/track';
import { PhaserGame } from '../game/PhaserGame';
import type { IRefPhaserGame } from '../game/PhaserGame';
import { EventBus, PianoEvents } from '../game/EventBus';
import type { LoadSongPayload, TileTappedPayload, HoldReleasedPayload, HoldBeatPayload } from '../game/EventBus';
import { PianoGameScene } from '../game/scenes/PianoGameScene';
import { buildAudioTileMap } from '../game/utils/gameTileAdapter';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PhaserGameBoardProps {
  /** Full parse result for the selected song. */
  result: MidiParseResult;

  /**
   * Called when a tile is tapped. Maps to useTileAudio.handleTileTap().
   * Receives a Tile (track.ts) converted from the tapped GameTile.
   */
  onPlayNote: (tile: Tile) => void;

  /**
   * Called on each beat tick while a hold tile is active.
   * Maps to useTileAudio.handleHoldBeat(). Receives the notes for that beat slot
   * (may be a chord) so the correct pitches are played.
   */
  onHoldBeat: (notes: ParsedNote[]) => void;

  /**
   * Called when a hold tile is released. Maps to useTileAudio.handleHoldRelease().
   * No tile argument needed — useTileAudio tracks the active hold internally.
   */
  onHoldRelease: () => void;

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
  onPlayNote,
  onHoldBeat,
  onHoldRelease,
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

  /**
   * Pre-built Map<GameTile.id, Tile> for O(1) audio tile lookup on each tap.
   * Rebuilt only when `result` changes (i.e. a new song is loaded).
   *
   * WHY useMemo: buildAudioTileMap iterates all tiles and handles DOUBLE pair
   * grouping — not expensive, but stable identity is important since the map
   * is captured by the EventBus listener closure.
   */
  const audioTileMap = useMemo(
    () => buildAudioTileMap(result.tiles),
    [result.tiles],
  );

  // Stable ref so EventBus listeners always call the latest callback version
  // without needing to re-register when speedMultiplier or result changes.
  const onPlayNoteRef = useRef(onPlayNote);
  onPlayNoteRef.current = onPlayNote;
  const onHoldBeatRef = useRef(onHoldBeat);
  onHoldBeatRef.current = onHoldBeat;
  const onHoldReleaseRef = useRef(onHoldRelease);
  onHoldReleaseRef.current = onHoldRelease;

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
    /**
     * Phaser's InputSystem emits TILE_TAPPED with { tile: GameTile }.
     * We look up the pre-converted Tile in audioTileMap and call onPlayNote.
     * The lookup is O(1) and the EventBus call is synchronous, so audio
     * fires with zero additional latency after the pointer event.
     */
    const handleTileTapped = ({ tile }: TileTappedPayload) => {
      const audioTile = audioTileMap.get(tile.id);
      if (audioTile) {
        onPlayNoteRef.current(audioTile);
      }
    };

    /**
     * HoldTileObject emits HOLD_BEAT on each secondary beat timer tick.
     * We forward the beat's notes to useTileAudio.handleHoldBeat() so the
     * correct pitches are played at the right musical moment.
     */
    const handleHoldBeat = ({ notes }: HoldBeatPayload) => {
      onHoldBeatRef.current(notes);
    };

    /**
     * Phaser's InputSystem emits HOLD_RELEASED when a held pointer lifts.
     * useTileAudio.handleHoldRelease() stops the sustain note internally;
     * it doesn't need the tile reference.
     */
    const handleHoldReleased = (_payload: HoldReleasedPayload) => {
      onHoldReleaseRef.current();
    };

    /** HUDSystem (Step 6) emits EXIT_GAME when the back button is tapped. */
    const handleExit = () => onExit();

    EventBus.on(PianoEvents.TILE_TAPPED, handleTileTapped);
    EventBus.on(PianoEvents.HOLD_BEAT, handleHoldBeat);
    EventBus.on(PianoEvents.HOLD_RELEASED, handleHoldReleased);
    EventBus.on(PianoEvents.EXIT_GAME, handleExit);

    return () => {
      EventBus.off(PianoEvents.TILE_TAPPED, handleTileTapped);
      EventBus.off(PianoEvents.HOLD_BEAT, handleHoldBeat);
      EventBus.off(PianoEvents.HOLD_RELEASED, handleHoldReleased);
      EventBus.off(PianoEvents.EXIT_GAME, handleExit);
    };
  }, [audioTileMap, onExit]);
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
