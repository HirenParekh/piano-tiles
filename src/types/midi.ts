export type InstrumentCategory = 'piano' | 'keyboard' | 'other';

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
  /** The assigned instrument for this note (e.g. 'piano', 'bass', 'drum') */
  instrument?: string;
  /** Original PT2 notation if parsed from a PianoTiles JSON song, e.g. "e3[L]", "c1[K]" */
  pt2Notation?: string;
  /** Absolute slot index (integer for 99% of cases) */
  slotStart: number;
  /** Duration in slots (bracketBeats / baseBeats) */
  slotSpan: number;
  /** Sub-slot audio offset for @%!~$^& operators (audio-only) */
  arpeggioDelayS?: number;
  /** Set to 'DOUBLE' for notes that belong to a 5<> double tile pair */
  tileType?: 'DOUBLE';
  /** Pre-resolved AudioBuffer — bound at instrument load time for zero-overhead tap playback */
  buffer?: AudioBuffer;
  /** Pre-merged AudioBuffer for chord tiles (SINGLE with 2+ notes) — play once instead of N times */
  mergedBuffer?: AudioBuffer;
}

// A tile in the game — one or more notes assigned to a lane
export interface GameTile {
  id: string;
  /** Primary (first) note — always present */
  note: ParsedNote;
  /** All notes in this tile — length > 1 means a hold tile */
  notes: ParsedNote[];
  /** 1-based indices of each note in the original ParsedNote[] array */
  noteIndices: number[];
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
  /** Tile start slot (absolute across whole song) */
  slotStart: number;
  /** Tile height in slots (>= 1) */
  slotSpan: number;
}

export interface ScrollSegment {
  startSlot: number;
  endSlot: number;
  slotDurationS: number; // For variable-BPM sections
  startPixel: number; // Bottom offset
  endPixel: number;
  startTime: number;  // Seconds
  endTime: number;
}

// Summary info about the loaded MIDI file
export interface MidiInfo {
  name: string;
  durationSeconds: number;
  bpm: number;
  /**
   * Effective BPM used for tile spacing and scroll speed.
   * For MIDI files: equals bpm.
   * For PianoTiles JSON songs: equals bpm / baseBeats (e.g. 90 BPM + 0.5 baseBeats → 180).
   * Formula from original game: TPS = effectiveBpm / 60 = BPM / (baseBeats × 60).
   */
  effectiveBpm?: number;
  timeSignature: [number, number];
  trackCount: number;
  totalNotes: number;
  scrollSegments?: ScrollSegment[];
}

// Full result from the MIDI parser
export interface MidiParseResult {
  info: MidiInfo;
  notes: ParsedNote[];
  tiles: GameTile[];
  /** Total canvas height in px — computed by buildSequentialLayout */
  totalHeight: number;
}
