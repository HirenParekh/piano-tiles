import type { ParsedNote, MidiParseResult, TrackMeta, GameTile, ScrollSegment } from '../types/midi';
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

// ── Tokeniser & Duration tables ──────────────────────────────────────────────

/** Rest token letter → beat duration (standalone tokens Q–Y, S = stop) */
const REST_BEATS: Record<string, number> = {
  Q: 8, R: 4, S: 2, T: 1, U: 0.5, V: 0.25, W: 0.125, X: 0.0625, Y: 0.03125,
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
 * Implements the exact timing logic from `pt2.cpp`:
 *  - N<...> groups are ignored visually; timing derives from brackets.
 *  - Standalone rest letters Q-Y (+ S = 2 beats) advance the timeline.
 *  - Tokens c1[L] advance the timeline by the bracket length.
 */
function parseScore(
  score: string,
  bpm: number,
  _baseBeats: number,
  trackIndex: number,
  trackName: string,
  instrument: string,
): { notes: ParsedNote[]; totalTimeS: number } {
  const notes: ParsedNote[] = [];
  const beatDurationS = 60 / bpm;

  // pt2.cpp ignores N<...> grouping entirely. We strip \d+< and > and effect brackets {}
  const flat = score
    .replace(/;/g, ',')
    .replace(/\d+</g, '')
    .replace(/>/g, '')
    .replace(/\{[^}]*\}/g, '');

  const tokens = flat.split(',');

  let currentTime = 0;

  for (let token of tokens) {
    token = token.trim();
    if (!token) continue;

    if (token === 'ST') {
      currentTime += 3 * beatDurationS; // S=2 + T=1
      continue;
    }

    if (/^[QRSSTUVWXYZ]+$/.test(token)) {
      let restBeats = 0;
      for (const ch of token) restBeats += REST_BEATS[ch] || 0;
      currentTime += restBeats * beatDurationS;
      continue;
    }

    const bracketBeats = parseBracketBeats(token, 0);
    const lengthS = bracketBeats * beatDurationS;

    if (lengthS === 0) {
      // Unparseable duration or missing bracket? Just skip
      continue;
    }

    const content = token.replace(/\[[^\]]*\]$/, '').trim();
    const inner = content.replace(/^\((.*)\)$/, '$1');

    const noteMatches = [...inner.matchAll(/([a-gA-G]#?-?\d*|mute|empty)|([.@%!~$^&])/gi)];
    const notesToPlay: string[] = [];
    const ops: string[] = [];

    for (const match of noteMatches) {
      const str = match[0];
      if (/^[a-g]/i.test(str) || str === 'mute' || str === 'empty') {
        notesToPlay.push(str);
      } else if (/[.@%!~$^&]/.test(str)) {
        ops.push(str);
      }
    }

    if (notesToPlay.length === 0) {
      currentTime += lengthS;
      continue;
    }

    const opCounts: Record<string, number> = { '.': 0, '@': 0, '%': 0, '!': 0, '~': 0, '$': 0, '^': 0, '&': 0 };
    for (const op of ops) opCounts[op] = (opCounts[op] || 0) + 1;

    let delayS = lengthS;
    if (opCounts['@'] > 0) {
      const count = opCounts['@'];
      delayS = lengthS / (count === 1 ? 10 : 10 * (count - 1));
    } else if (opCounts['%'] > 0) {
      delayS = (3 * lengthS) / (10 * opCounts['%']);
    } else if (opCounts['!'] > 0) {
      delayS = (3 * lengthS) / (20 * opCounts['!']);
    } else if (opCounts['~'] > 0 || opCounts['$'] > 0) {
      const count = opCounts['~'] + opCounts['$'];
      delayS = lengthS / (count + 1);
    } else if (opCounts['^'] > 0 || opCounts['&'] > 0) {
      // Ornaments oscillate rapidly over a short delay
      delayS = beatDurationS / 24;
    } else {
      delayS = 0;
    }

    let tokenTime = currentTime;

    const bracketStr = token.match(/\[[HIJKLMNOP]+\]/)?.[0] ?? '';

    for (let i = 0; i < notesToPlay.length; i++) {
      const rawName = notesToPlay[i];
      const parsed = parseNoteName(rawName);
      if (parsed) {
        notes.push({
          midi: parsed.midi,
          name: parsed.name,
          time: tokenTime,
          duration: Math.max(lengthS - (tokenTime - currentTime), 0.05),
          velocity: 0.7,
          trackIndex,
          trackName,
          channel: trackIndex,
          instrument,
          pt2Notation: rawName + bracketStr,
        });
      }

      if (i < notesToPlay.length - 1) {
        tokenTime += delayS;
      }
    }

    currentTime += lengthS;
  }

  return { notes, totalTimeS: currentTime };
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
  const { bpm, baseBeats, scores, instruments, alternatives } = music;

  const allNotes: ParsedNote[] = [];

  scores.forEach((score, i) => {
    const trackName = i === 0 ? 'Melody' : i === 1 ? 'Bass' : `Track ${i + 1}`;
    const instr = (alternatives?.[i] || instruments?.[i] || 'piano').toLowerCase();
    allNotes.push(...parseScore(score, bpm, baseBeats, i, trackName, instr).notes);
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
  audioScoreIndices: number[] = [0, 1],
): MidiParseResult {
  const allNotes: ParsedNote[] = [];
  const allTiles: GameTile[] = [];
  const scrollSegments: ScrollSegment[] = [];

  let maxTrackCount = 0;
  let globalLastLane = -1;

  const initialMusic = song.musics[musicIndex] ?? song.musics[0];
  const initialBpm = initialMusic?.bpm || 100;
  const initialEffectiveBpm = initialMusic ? Math.round(initialMusic.bpm / initialMusic.baseBeats) : 100;

  // Add 5 blank rows (slots) of offset so the first actual tile starts off-screen
  // allowing the user to see 4 empty spaces above the START tile falling from the top.
  const START_OFFSET_ROWS = 5;
  const MIN_HEIGHT = 100;
  const initialSlotDurationS = initialMusic ? initialMusic.baseBeats * (60 / initialMusic.bpm) : 0.6;

  let currentTimeOffset = START_OFFSET_ROWS * initialSlotDurationS;
  let currentBottomOffset = START_OFFSET_ROWS * MIN_HEIGHT;

  if (START_OFFSET_ROWS > 0) {
    scrollSegments.push({
      startPixel: 0,
      endPixel: currentBottomOffset,
      startTime: 0,
      endTime: currentTimeOffset,
    });
  }

  // We play all musics consecutively starting from 0, to build the full endless-style track map
  song.musics.forEach((music) => {
    const { bpm, baseBeats, scores, instruments, alternatives } = music;
    const sectionNotes: ParsedNote[] = [];
    let maxSectionTimeS = 0;

    if (scores.length > maxTrackCount) {
      maxTrackCount = scores.length;
    }

    // 1. Parse notes for this section (results are time=0 based)
    scores.forEach((score, i) => {
      const trackName = i === 0 ? 'Melody' : i === 1 ? 'Bass' : `Track ${i + 1}`;
      const instr = (alternatives?.[i] || instruments?.[i] || 'piano').toLowerCase();
      const parsed = parseScore(score, bpm, baseBeats, i, trackName, instr);
      sectionNotes.push(...parsed.notes);
      if (parsed.totalTimeS > maxSectionTimeS) {
        maxSectionTimeS = parsed.totalTimeS;
      }
    });

    sectionNotes.sort((a, b) => a.time - b.time);

    // 2. Build local tiles at relative time 0
    const slotDurationS = baseBeats * (60 / bpm);

    const melodyNotes = sectionNotes.filter(n => n.trackIndex === 0);
    const accompNotes = sectionNotes.filter(
      n => n.trackIndex !== 0 && audioScoreIndices.includes(n.trackIndex)
    );

    // Split bass notes into two groups:
    // - bassAccomp: falls within a melody note's time window → becomes a dot on that tile
    // - bassTileNotes: falls in a melody rest gap → becomes its own tappable tile
    const bassAccomp: typeof accompNotes = [];
    const bassTileNotes: typeof accompNotes = [];
    for (const bassNote of accompNotes) {
      const overlaps = melodyNotes.some(
        m => bassNote.time >= m.time - 0.001 && bassNote.time < m.time + m.duration - 0.001
      );
      if (overlaps) bassAccomp.push(bassNote);
      else bassTileNotes.push(bassNote);
    }

    // Tiles come from melody + bass notes at melody-rest positions (must be sorted by time)
    const tileNotes = [...melodyNotes, ...bassTileNotes].sort((a, b) => a.time - b.time);
    const { tiles: sectionTiles, lastLane } = buildTilesFromNotes(tileNotes, bpm, slotDurationS, globalLastLane);
    globalLastLane = lastLane;

    // Attach bassAccomp notes to their melody tile by time-window coverage
    const sortedTiles = [...sectionTiles].sort((a, b) => a.note.time - b.note.time);
    for (const accNote of bassAccomp) {
      for (const tile of sortedTiles) {
        if (accNote.time >= tile.note.time - 0.001 &&
          accNote.time < tile.note.time + tile.note.duration - 0.001) {
          // TODO: suppress accompaniment notes with same pitch class as a hold tile's melody note.
          // Confirmed by experiment: e1 (E) silent inside e3[K] (E), c1 (C) shows dot, e2 (E) suppressed.
          // const isHold = tile.note.duration > slotDurationS + 0.001;
          // if (!(isHold && (accNote.midi % 12) === (tile.note.midi % 12)))
          tile.notes.push(accNote);
          break;
        }
      }
    }

    // To ensure perfect synchronization between visual placement and audio start times
    // for subsequent sections, we strictly advance the clock according to the parsed track bounds.
    const MIN_HEIGHT = 100;

    // We quantize the total track time to beats (in case of floating point drift)
    const sectionLayoutBeats = Math.max(1, Math.round(maxSectionTimeS / slotDurationS));

    // The height is simply the total beats in the score * the MIN_HEIGHT constant.
    const sectionPureHeight = sectionLayoutBeats * MIN_HEIGHT;
    const sectionLayoutTimeS = sectionLayoutBeats * slotDurationS;

    // 3. Shift all times to absolute coordinate space
    sectionNotes.forEach(n => {
      n.time += currentTimeOffset;
    });

    // 4. Shift Y-offsets (bottom up)
    sectionTiles.forEach((tile) => {
      tile.bottomOffset += currentBottomOffset;
    });

    allNotes.push(...sectionNotes.filter(n => audioScoreIndices.includes(n.trackIndex)));
    allTiles.push(...sectionTiles);

    // Store scroll mapping segment
    scrollSegments.push({
      startPixel: currentBottomOffset,
      endPixel: currentBottomOffset + sectionPureHeight,
      startTime: currentTimeOffset,
      endTime: currentTimeOffset + sectionLayoutTimeS,
    });

    // 5. Advance global offsets
    currentTimeOffset += sectionLayoutTimeS;
    currentBottomOffset += sectionPureHeight;
  });

  allNotes.sort((a, b) => a.time - b.time);

  // Recalibrate the final array of tiles to have the true valid 'top' style
  const LAYOUT_PAD_TOP = 160;
  const finalTotalHeight = currentBottomOffset + LAYOUT_PAD_TOP;

  allTiles.forEach((tile, index) => {
    // Generate fresh unique IDs over the whole song since local IDs reset to 0
    tile.id = `tile-${index}-${tile.note.midi}-${tile.note.time.toFixed(3)}`;
    tile.top = finalTotalHeight - tile.bottomOffset - tile.height;
  });

  const durationSeconds =
    allNotes.length > 0
      ? allNotes[allNotes.length - 1].time + allNotes[allNotes.length - 1].duration
      : 0;

  const tracks: TrackMeta[] = Array.from({ length: maxTrackCount }).map((_, i) => ({
    index: i,
    name: i === 0 ? 'Melody' : i === 1 ? 'Bass' : `Track ${i + 1}`,
    program: 0,
    instrName: 'Acoustic Grand Piano',
    category: 'piano' as const,
    noteCount: allNotes.filter(n => n.trackIndex === i).length,
    channel: i,
    autoSelected: true,
  }));

  return {
    info: {
      name: songName,
      durationSeconds,
      bpm: initialBpm,
      effectiveBpm: initialEffectiveBpm,
      timeSignature: [4, 4],
      trackCount: maxTrackCount,
      totalNotes: allNotes.length,
      scrollSegments,
    },
    tracks,
    notes: allNotes,
    tiles: allTiles,
    totalHeight: finalTotalHeight,
  };
}
