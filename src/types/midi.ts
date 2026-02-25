export type InstrumentCategory = 'piano' | 'keyboard' | 'other';

// Metadata about a single MIDI track, before note extraction
export interface TrackMeta {
  index: number;
  name: string;
  program: number | null;
  instrName: string;
  category: InstrumentCategory;
  noteCount: number;
  channel: number;
  /** Whether this track was auto-detected as piano/keyboard */
  autoSelected: boolean;
}

// Represents a single parsed note from a MIDI file
export interface ParsedNote {
  /** MIDI note number (0–127) */
  midi: number;
  /** Human-readable note name, e.g. "C4", "F#3" */
  name: string;
  /** Time in seconds when the note starts */
  time: number;
  /** Duration in seconds */
  duration: number;
  /** Velocity 0–1 */
  velocity: number;
  /** Which track this note came from */
  trackIndex: number;
  /** Human-readable track name */
  trackName: string;
  /** Which instrument/channel (0–15) */
  channel: number;
}

// A tile in the game — one note assigned to a lane
export interface GameTile {
  id: string;
  note: ParsedNote;
  /** Lane 0–3 (left to right) */
  lane: number;
  /** Whether this tile has been tapped */
  tapped: boolean;
  /** Tile height in px — beat-quantized (multiples of MIN_HEIGHT) */
  height: number;
  /** Distance from canvas bottom — sequential stacking per lane */
  bottomOffset: number;
  /** CSS top = totalHeight - bottomOffset - height */
  top: number;
}

// Summary info about the loaded MIDI file
export interface MidiInfo {
  name: string;
  durationSeconds: number;
  bpm: number;
  timeSignature: [number, number];
  trackCount: number;
  totalNotes: number;
}

// Full result from the MIDI parser
export interface MidiParseResult {
  info: MidiInfo;
  tracks: TrackMeta[];
  notes: ParsedNote[];
  tiles: GameTile[];
  /** Total canvas height in px — computed by buildSequentialLayout */
  totalHeight: number;
}
