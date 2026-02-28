import type { ParsedNote, MidiParseResult, TrackMeta } from '../types/midi';
import { buildTilesFromNotes } from './midiParser';

// ── PianoTiles JSON song format ─────────────────────────────────────────────
export interface PianoTilesSong {
  baseBpm: number;
  musics: PianoTilesMusic[];
  audition?: { start: number[]; end: number[] };
}

export interface PianoTilesMusic {
  id: number;
  bpm: number;
  baseBeats: number;
  scores: string[];
  instruments?: string[];
  alternatives?: string[];
}

// ── Note name → MIDI ────────────────────────────────────────────────────────
// PianoTiles octave mapping (confirmed from json2midi source):
//   formula: midi = (octave + 4) × 12 + noteOffset
//   e.g.  "c"  (oct 0)  → C3  (MIDI 48)
//         "c1" (oct 1)  → C4  (MIDI 60) — middle C
//         "c2" (oct 2)  → C5  (MIDI 72)
//         "g2"          → G5  (MIDI 79)
//         "G-1"         → G2  (MIDI 43)  (uppercase = negative octave by convention)
//         "A-3"         → A0  (MIDI 21)  — lowest piano key
//         "c5"          → C8  (MIDI 108) — highest piano key

const NOTE_OFFSETS: Record<string, number> = {
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Parse a raw PianoTiles note name to MIDI + Tone.js name string. */
function parseNoteName(raw: string): { midi: number; name: string } | null {
  if (raw === 'mute' || raw === 'empty') return null;

  // Pattern: optional #, note letter (case-insensitive), optional signed octave integer
  const m = raw.trim().match(/^(#?)([a-gA-G])(-?\d*)$/);
  if (!m) return null;

  const isSharp = m[1] === '#';
  const letter = m[2].toLowerCase();
  const octave = m[3] === '' ? 0 : parseInt(m[3], 10);

  const offset = NOTE_OFFSETS[letter];
  if (offset === undefined) return null;

  // Confirmed by json2midi source: (octave + 4) × 12 + offset
  // c1 → (1+4)×12+0 = 60 = C4 (middle C)
  // c2 → (2+4)×12+0 = 72 = C5
  // A-3 → (-3+4)×12+9 = 21 = A0 (lowest piano key)
  const midi = (octave + 4) * 12 + offset + (isSharp ? 1 : 0);
  if (midi < 0 || midi > 127) return null;

  const noteName = NOTE_NAMES[midi % 12];
  const toneOctave = Math.floor(midi / 12) - 1;
  return { midi, name: `${noteName}${toneOctave}` };
}

// ── Tokeniser ───────────────────────────────────────────────────────────────

/** Split a string by commas, ignoring commas inside <> brackets. */
function splitByComma(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '<') depth++;
    else if (s[i] === '>') depth--;
    else if (s[i] === ',' && depth === 0) {
      const p = s.slice(start, i).trim();
      if (p) parts.push(p);
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

/**
 * Extract note name strings from a token.
 * Strips the trailing [type] bracket and optional {n} effect, handles chords: "(n1.n2)[K]" → ["n1", "n2"].
 */
function extractNoteNames(token: string): string[] {
  // Remove trailing tile-type bracket e.g. "[K]", "[LM]", and optional "{n}" special effect
  const stripped = token.replace(/\[[^\]]*\](\{\d+\})?$/, '').trim();

  // Chord notation: (n1.n2)
  const chordMatch = stripped.match(/^\(([^)]+)\)$/);
  if (chordMatch) {
    return chordMatch[1].split('.');
  }

  return [stripped];
}

// ── Duration tables ──────────────────────────────────────────────────────────

/** Rest token letter → beat duration (standalone tokens Q–Y, S = stop) */
const REST_BEATS: Record<string, number> = {
  Q: 8, R: 4, T: 1, U: 0.5, V: 0.25, W: 0.125, X: 0.0625, Y: 0.03125,
};

/** Bracket letter → beat duration (inside [...]) */
const BRACKET_BEATS: Record<string, number> = {
  H: 8, I: 4, J: 2, K: 1, L: 0.5, M: 0.25, N: 0.125, O: 0.0625, P: 0.03125,
};

/**
 * Sum beat values from a tile-length bracket, e.g. "[LM]" → 0.75 beats.
 * Falls back to fallbackBeats if no bracket found or bracket is empty.
 */
function parseBracketBeats(token: string, fallbackBeats: number): number {
  const m = token.match(/\[([HIJKLMNOP]+)\]/);
  if (!m) return fallbackBeats;
  let beats = 0;
  for (const ch of m[1]) beats += BRACKET_BEATS[ch] ?? 0;
  return beats > 0 ? beats : fallbackBeats;
}

// ── Score string parser ─────────────────────────────────────────────────────

/**
 * Parse one PianoTiles score string into a flat list of ParsedNote events.
 *
 * Grammar (comma-separated items, semicolons treated as commas):
 *   item     = rest | stop | group | note | chord
 *   rest     = Q|R|T|U|V|W|X|Y  (standalone letter — advances time by restBeats × beatDurationS)
 *   stop     = "S" | "ST"
 *   group    = N "<" items ">"  — N slots total, items divided evenly
 *   note     = noteName "[" letters "]"
 *   chord    = "(" noteName ("." noteName)+ ")" "[" letters "]"
 *
 * Timeline:
 *   Every top-level token (except rest) advances time by exactly 1 slot = slotDurationS.
 *   Rest tokens advance by their beat value × beatDurationS.
 *   Bracket letters determine audio duration: bracketBeats × beatDurationS.
 */
function parseScore(
  score: string,
  bpm: number,
  baseBeats: number,
  trackIndex: number,
  trackName: string,
): ParsedNote[] {
  const notes: ParsedNote[] = [];

  const slotDurationS = baseBeats * (60 / bpm); // time per comma-slot
  const beatDurationS = 60 / bpm;               // time per beat

  // Semicolons are visual-only measure markers — treat like commas
  const flat = score.replace(/;/g, ',');
  const tokens = splitByComma(flat);

  let currentTime = 0;

  for (const token of tokens) {
    if (!token) continue;

    // Stop
    if (token === 'S' || token === 'ST') break;

    // Rest / silence — advance by restBeats × beatDurationS
    const restBeats = REST_BEATS[token];
    if (restBeats !== undefined) {
      currentTime += restBeats * beatDurationS;
      continue;
    }

    // N<items> group — e.g. "9<G-1[HI]>", "5<a2[L],g2[L]>"
    const groupMatch = token.match(/^(\d+)<(.+)>$/s);
    if (groupMatch) {
      const n = parseInt(groupMatch[1], 10);
      const innerItems = splitByComma(groupMatch[2]);
      const totalDuration = n * slotDurationS;

      if (innerItems.length > 0) {
        const subDuration = totalDuration / innerItems.length;
        let subTime = currentTime;

        for (const inner of innerItems) {
          if (inner === 'S' || inner === 'ST') break;
          // Rest or silence inside group — advance sub-time
          if (REST_BEATS[inner] !== undefined || inner === 'mute' || inner === 'empty') {
            subTime += subDuration;
            continue;
          }
          for (const rawName of extractNoteNames(inner)) {
            const parsed = parseNoteName(rawName);
            if (parsed) {
              notes.push({
                midi: parsed.midi,
                name: parsed.name,
                time: subTime,
                duration: Math.max(subDuration, 0.05),
                velocity: 0.7,
                trackIndex,
                trackName,
                channel: trackIndex,
              });
            }
          }
          subTime += subDuration;
        }
      }

      currentTime += totalDuration;
      continue;
    }

    // Single note or chord — audio duration from bracket letters
    const bracketBeats = parseBracketBeats(token, baseBeats); // default 1 slot = baseBeats beats
    const noteDurationS = Math.max(bracketBeats * beatDurationS, 0.05);

    for (const rawName of extractNoteNames(token)) {
      const parsed = parseNoteName(rawName);
      if (parsed) {
        notes.push({
          midi: parsed.midi,
          name: parsed.name,
          time: currentTime,
          duration: noteDurationS,
          velocity: 0.7,
          trackIndex,
          trackName,
          channel: trackIndex,
        });
      }
    }
    currentTime += slotDurationS;
  }

  return notes;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a PianoTiles song JSON into a sorted ParsedNote[] array.
 * @param song     The parsed JSON object.
 * @param musicIndex  Difficulty level index (0 = easiest).
 */
export function parsePianoTilesNotes(
  song: PianoTilesSong,
  musicIndex = 0,
): { notes: ParsedNote[]; bpm: number } {
  const music = song.musics[musicIndex] ?? song.musics[0];
  const { bpm, baseBeats, scores } = music;

  const allNotes: ParsedNote[] = [];

  scores.forEach((score, i) => {
    const trackName = i === 0 ? 'Melody' : i === 1 ? 'Bass' : `Track ${i + 1}`;
    allNotes.push(...parseScore(score, bpm, baseBeats, i, trackName));
  });

  allNotes.sort((a, b) => a.time - b.time);
  return { notes: allNotes, bpm };
}

/**
 * Build a complete MidiParseResult from a PianoTiles song JSON.
 * Drop-in replacement for the MIDI parser output.
 *
 * @param tileScoreIndices  Which score-string indices (0=Melody, 1=Bass, …) produce
 *                          tappable tiles. All scores still go into result.notes for audio.
 *                          Defaults to [0] (melody only).
 */
export function buildResultFromPianoTilesSong(
  song: PianoTilesSong,
  musicIndex = 0,
  songName = 'Unknown',
  tileScoreIndices: number[] = [0],
): MidiParseResult {
  const music = song.musics[musicIndex] ?? song.musics[0];
  const { notes, bpm } = parsePianoTilesNotes(song, musicIndex);

  // From the original game: TPS = BPM / (baseBeats × 60)
  // Each comma-separated slot = one tile = baseBeats × (60/bpm) seconds.
  // We must use the slot duration (not the beat duration) as the quantisation
  // unit so that adjacent slots are never merged and the scroll speed is correct.
  const slotDurationS = music.baseBeats * (60 / bpm);
  const effectiveBpm  = Math.round(bpm / music.baseBeats); // TPS * 60

  // Only notes from selected scores become tappable tiles.
  const tileNotes = notes.filter(n => tileScoreIndices.includes(n.trackIndex));
  const { tiles, totalHeight } = buildTilesFromNotes(tileNotes, bpm, slotDurationS, true);

  const durationSeconds =
    notes.length > 0
      ? notes[notes.length - 1].time + notes[notes.length - 1].duration
      : 0;

  const tracks: TrackMeta[] = (music.scores ?? []).map((_, i) => ({
    index: i,
    name: i === 0 ? 'Melody' : i === 1 ? 'Bass' : `Track ${i + 1}`,
    program: 0,
    instrName: 'Acoustic Grand Piano',
    category: 'piano' as const,
    noteCount: notes.filter(n => n.trackIndex === i).length,
    channel: i,
    autoSelected: true,
  }));

  return {
    info: {
      name: songName,
      durationSeconds,
      bpm,
      effectiveBpm,
      timeSignature: [4, 4],
      trackCount: music.scores.length,
      totalNotes: notes.length,
    },
    tracks,
    notes,
    tiles,
    totalHeight,
  };
}
