/**
 * EventBus.ts
 *
 * A single shared event emitter that acts as the communication channel
 * between React components and Phaser scenes.
 *
 * WHY: React and Phaser live in separate runtime environments:
 *   - React manages component state and UI lifecycle
 *   - Phaser runs its own game loop inside a canvas
 *
 * Direct calls across this boundary are fragile (timing issues, ref access).
 * An event bus decouples the two sides: neither needs to know about the
 * other's internals — they only need to agree on event names and payloads.
 *
 * USAGE PATTERN:
 *   React → Phaser:  EventBus.emit(PianoEvents.LOAD_SONG, payload)
 *   Phaser → React:  EventBus.on(PianoEvents.TILE_TAPPED, handler)
 *
 * All event name strings are defined in `PianoEvents` below to prevent
 * typos and make refactoring safe.
 */

import { Events } from 'phaser';

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------

/**
 * All event names used on the EventBus.
 *
 * Using a `const` object (rather than an enum) keeps the emitted strings
 * predictable at runtime and avoids TypeScript enum quirks.
 */
export const PianoEvents = {
  /**
   * Emitted by a Phaser Scene in its `create()` method to let React know
   * which scene is currently active. Payload: the Phaser.Scene instance.
   */
  CURRENT_SCENE_READY: 'current-scene-ready',

  /**
   * Emitted by React (PhaserGameBoard) after a song is selected.
   * Tells PianoGameScene which tiles to render and how fast to scroll.
   * Payload: LoadSongPayload
   */
  LOAD_SONG: 'load-song',

  /**
   * Emitted by the Phaser InputSystem when the player taps a tile.
   * React listens to call useTileAudio.handleTileTap().
   * Payload: TileTappedPayload
   */
  TILE_TAPPED: 'tile-tapped',

  /**
   * Emitted by HoldTileObject on each beat tick while a hold tile is active.
   * React listens to trigger the sustain audio pulse.
   * Payload: HoldBeatPayload
   */
  HOLD_BEAT: 'hold-beat',

  /**
   * Emitted by the Phaser InputSystem when the player lifts their finger
   * off a hold tile (pointerup / pointercancel).
   * React listens to stop the sustain audio.
   * Payload: HoldReleasedPayload
   */
  HOLD_RELEASED: 'hold-released',

  /**
   * Emitted by ScoreSystem whenever the score changes.
   * React can optionally mirror this value in its own state (e.g. for
   * showing a final score screen).
   * Payload: { score: number }
   */
  SCORE_CHANGED: 'score-changed',

  /**
   * Emitted by the Phaser HUDSystem when the player taps the back button.
   * React listens to transition back to the song selection screen.
   * No payload.
   */
  EXIT_GAME: 'exit-game',
} as const;

// Derive a union type of all valid event name strings for type-safe listeners.
export type PianoEventName = (typeof PianoEvents)[keyof typeof PianoEvents];

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------
// These live here (rather than a separate events.ts) to keep the contract
// co-located with the event names that reference them.

import type { GameTile, MidiParseResult, ParsedNote, ScrollSegment } from '../types/midi';

/**
 * Data sent when React loads a song into the Phaser scene.
 */
export interface LoadSongPayload {
  /** All game tiles for the song, slot-positioned. */
  tiles: GameTile[];
  /** Full parse result (includes `info` with BPM, baseBeats, etc.). */
  result: MidiParseResult;
  /**
   * Variable-speed scroll segments, if the song has tempo changes.
   * Empty array for constant-BPM songs.
   */
  scrollSegments: ScrollSegment[];
  /** Playback speed multiplier (1.0 = normal, 0.5 = half speed). */
  speedMultiplier: number;
  /**
   * When true, PianoGameScene adds note-name labels to every tile.
   * Equivalent to the CSS board's "debug" skin — shows PT2 notation
   * (e.g. "g2[L]") and note names on each tile for development inspection.
   */
  debug?: boolean;
}

/**
 * Data sent when a tile is tapped in Phaser.
 * React uses this to trigger audio playback.
 */
export interface TileTappedPayload {
  tile: GameTile;
}

/**
 * Data sent on each hold-tile beat tick.
 * `notes` contains the ParsedNote entries for this beat slot —
 * PhaserGameBoard forwards them to useTileAudio.handleHoldBeat(notes).
 */
export interface HoldBeatPayload {
  tile: GameTile;
  /** Notes for this secondary beat slot (may be a chord). */
  notes: ParsedNote[];
}

/** Data sent when a hold tile is released. */
export interface HoldReleasedPayload {
  tile: GameTile;
}

// ---------------------------------------------------------------------------
// Singleton event emitter
// ---------------------------------------------------------------------------

/**
 * The global EventBus instance.
 *
 * Import this singleton in any React component or Phaser scene that needs
 * to communicate across the framework boundary.
 *
 * Phaser's EventEmitter is synchronous: when `.emit()` is called, all
 * registered listeners run before the next line executes. This means
 * audio callbacks triggered from Phaser's input system have zero
 * event-loop-tick latency — critical for tap responsiveness.
 */
export const EventBus = new Events.EventEmitter();
