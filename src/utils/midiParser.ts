import { Midi } from '@tonejs/midi';
import type {
  ParsedNote,
  GameTile,
  MidiInfo,
  MidiParseResult,
  TrackMeta,
  InstrumentCategory,
} from '../types/midi';

const LANE_COUNT = 4;

// ── General MIDI instrument map ────────────────────────────────────────────
export const GM_INSTRUMENTS: Record<number, string> = {
  0: 'Acoustic Grand Piano', 1: 'Bright Acoustic Piano', 2: 'Electric Grand Piano',
  3: 'Honky-tonk Piano', 4: 'Electric Piano 1', 5: 'Electric Piano 2',
  6: 'Harpsichord', 7: 'Clavinet',
  8: 'Celesta', 9: 'Glockenspiel', 10: 'Music Box', 11: 'Vibraphone',
  12: 'Marimba', 13: 'Xylophone', 14: 'Tubular Bells', 15: 'Dulcimer',
  16: 'Drawbar Organ', 17: 'Percussive Organ', 18: 'Rock Organ',
  19: 'Church Organ', 20: 'Reed Organ', 21: 'Accordion',
  22: 'Harmonica', 23: 'Tango Accordion',
  24: 'Acoustic Guitar (nylon)', 25: 'Acoustic Guitar (steel)',
  26: 'Electric Guitar (jazz)', 27: 'Electric Guitar (clean)',
  28: 'Electric Guitar (muted)', 29: 'Overdriven Guitar',
  30: 'Distortion Guitar', 31: 'Guitar Harmonics',
  32: 'Acoustic Bass', 33: 'Electric Bass (finger)',
  34: 'Electric Bass (pick)', 35: 'Fretless Bass',
  36: 'Slap Bass 1', 37: 'Slap Bass 2', 38: 'Synth Bass 1', 39: 'Synth Bass 2',
  40: 'Violin', 41: 'Viola', 42: 'Cello', 43: 'Contrabass',
  44: 'Tremolo Strings', 45: 'Pizzicato Strings', 46: 'Orchestral Harp', 47: 'Timpani',
  48: 'String Ensemble 1', 49: 'String Ensemble 2',
  50: 'Synth Strings 1', 51: 'Synth Strings 2',
  52: 'Choir Aahs', 53: 'Voice Oohs', 54: 'Synth Voice', 55: 'Orchestra Hit',
  56: 'Trumpet', 57: 'Trombone', 58: 'Tuba', 59: 'Muted Trumpet',
  60: 'French Horn', 61: 'Brass Section', 62: 'Synth Brass 1', 63: 'Synth Brass 2',
  64: 'Soprano Sax', 65: 'Alto Sax', 66: 'Tenor Sax', 67: 'Baritone Sax',
  68: 'Oboe', 69: 'English Horn', 70: 'Bassoon', 71: 'Clarinet',
  72: 'Piccolo', 73: 'Flute', 74: 'Recorder', 75: 'Pan Flute',
  80: 'Lead 1 (square)', 81: 'Lead 2 (sawtooth)', 88: 'Pad 1 (new age)',
};

const KEYBOARD_KEYWORDS =
  /piano|keyboard|keys|grand|upright|electric\s*pno|synth\s*keys|organ|harpsichord|clavi|vibes|marimba|xylophone|celesta/i;

export function getInstrumentCategory(program: number | null): InstrumentCategory {
  if (program === null) return 'other';
  if (program >= 0 && program <= 7)  return 'piano';
  if (program >= 8 && program <= 23) return 'keyboard';
  return 'other';
}

export function isKeyboardByName(name: string): boolean {
  return KEYBOARD_KEYWORDS.test(name);
}

// ── Lane assignment ────────────────────────────────────────────────────────
function assignLane(midiNumber: number, laneUsageCounts: number[]): number {
  const zone = Math.min(Math.floor((midiNumber / 128) * LANE_COUNT), LANE_COUNT - 1);
  const candidates = [Math.max(0, zone - 1), zone, Math.min(LANE_COUNT - 1, zone + 1)];
  let chosenLane = zone;
  let minCount = Infinity;
  for (const lane of candidates) {
    if (laneUsageCounts[lane] < minCount) {
      minCount = laneUsageCounts[lane];
      chosenLane = lane;
    }
  }
  return chosenLane;
}

// ── Track metadata extraction ──────────────────────────────────────────────
export function extractTrackMeta(midi: Midi): TrackMeta[] {
  return midi.tracks.map((track, i) => {
    const program = track.instrument?.number ?? null;
    const name = track.name?.trim() || `Track ${i + 1}`;
    let category = getInstrumentCategory(program);
    if (category === 'other' && isKeyboardByName(name)) category = 'keyboard';

    const instrName =
      program !== null && GM_INSTRUMENTS[program]
        ? GM_INSTRUMENTS[program]
        : program !== null ? `Program ${program}` : 'Unknown';

    return {
      index: i,
      name,
      program,
      instrName,
      category,
      noteCount: track.notes.length,
      channel: track.channel ?? i,
      autoSelected: category !== 'other',
    };
  });
}

// ── Sequential layout — beat-quantized heights, no time gaps ──────────────
const MIN_HEIGHT     = 90;   // px — 1 beat minimum
const TILE_GAP       = 6;    // px between consecutive tiles in same lane
const LAYOUT_PAD_TOP = 160;
const LAYOUT_PAD_BOT = 120;

function buildSequentialLayout(tiles: GameTile[], bpm: number): number {
  const cursors = [0, 0, 0, 0]; // next available bottomOffset per lane

  for (const tile of tiles) {
    const durationBeats = tile.note.duration * (bpm / 60);
    const snappedBeats  = Math.max(1, Math.round(durationBeats * 2) / 2);
    tile.height       = snappedBeats * MIN_HEIGHT;
    tile.bottomOffset = cursors[tile.lane];
    cursors[tile.lane] += tile.height + TILE_GAP;
  }

  const totalHeight = Math.max(...cursors) + LAYOUT_PAD_TOP + LAYOUT_PAD_BOT;

  for (const tile of tiles) {
    tile.top = totalHeight - tile.bottomOffset - tile.height;
  }

  return totalHeight;
}

// ── Build tiles from selected tracks ──────────────────────────────────────
export function buildTilesFromTracks(
  midi: Midi,
  trackMeta: TrackMeta[],
  selectedIndices: Set<number>
): { notes: ParsedNote[]; tiles: GameTile[]; totalHeight: number } {
  const notes: ParsedNote[] = [];

  midi.tracks.forEach((track, ti) => {
    if (!selectedIndices.has(ti)) return;
    const meta = trackMeta[ti];
    track.notes.forEach((note) => {
      notes.push({
        midi: note.midi,
        name: note.name,
        time: note.time,
        duration: note.duration,
        velocity: note.velocity,
        trackIndex: ti,
        trackName: meta?.name ?? `Track ${ti + 1}`,
        channel: track.channel ?? 0,
      });
    });
  });

  notes.sort((a, b) => a.time - b.time);

  const laneUsageCounts = [0, 0, 0, 0];
  const tiles: GameTile[] = notes.map((note, index) => {
    const lane = assignLane(note.midi, laneUsageCounts);
    laneUsageCounts[lane]++;
    return {
      id: `tile-${index}-${note.midi}-${note.time.toFixed(3)}`,
      note,
      lane,
      tapped: false,
      height: 0,
      bottomOffset: 0,
      top: 0,
    };
  });

  // Overlap detection: if two tiles land in the same lane and overlap in time,
  // move the later one to whichever lane becomes free soonest.
  const laneEndTimes = [0, 0, 0, 0];
  const GAP = 0.05;

  for (const tile of tiles) {
    const startTime = tile.note.time;
    const endTime   = tile.note.time + tile.note.duration;

    if (startTime < laneEndTimes[tile.lane] + GAP) {
      const candidates = [0, 1, 2, 3]
        .filter(l => l !== tile.lane)
        .sort((a, b) => laneEndTimes[a] - laneEndTimes[b]);

      for (const candidate of candidates) {
        if (startTime >= laneEndTimes[candidate] + GAP) {
          tile.lane = candidate;
          break;
        }
      }
    }

    laneEndTimes[tile.lane] = Math.max(laneEndTimes[tile.lane], endTime);
  }

  const bpm = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120;
  const totalHeight = buildSequentialLayout(tiles, bpm);

  return { notes, tiles, totalHeight };
}

// ── Full parse entry point ─────────────────────────────────────────────────
export async function parseMidiFile(
  buffer: ArrayBuffer,
  fileName: string,
  selectedTrackIndices?: Set<number>
): Promise<MidiParseResult & { rawMidi: Midi }> {
  const midi = new Midi(buffer);

  const bpm = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120;
  const timeSig =
    midi.header.timeSignatures.length > 0
      ? midi.header.timeSignatures[0].timeSignature
      : [4, 4];

  const tracks = extractTrackMeta(midi);

  const selected = selectedTrackIndices ?? (() => {
    const auto = new Set(tracks.filter((t) => t.autoSelected).map((t) => t.index));
    return auto.size > 0 ? auto : new Set(tracks.map((t) => t.index));
  })();

  const info: MidiInfo = {
    name: fileName.replace(/\.midi?$/i, ''),
    durationSeconds: midi.duration,
    bpm: Math.round(bpm),
    timeSignature: [timeSig[0], timeSig[1]] as [number, number],
    trackCount: midi.tracks.length,
    totalNotes: midi.tracks.reduce((sum, t) => sum + t.notes.length, 0),
  };

  const { notes, tiles, totalHeight } = buildTilesFromTracks(midi, tracks, selected);

  return { info, tracks, notes, tiles, totalHeight, rawMidi: midi };
}

// ── File reader ────────────────────────────────────────────────────────────
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result instanceof ArrayBuffer) resolve(e.target.result);
      else reject(new Error('Failed to read file as ArrayBuffer'));
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsArrayBuffer(file);
  });
}
