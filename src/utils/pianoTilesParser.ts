import type { ParsedNote, MidiParseResult, GameTile, ScrollSegment } from '../types/midi';
import { buildTilesFromNotes } from './tileBuilder';

export interface CatalogEntry {
  id: string;
  title: string;
  author: string;
  level: number;
  stars: number;
  csvId: string;
  mid: string;
  bpm: string;
  baseBeat: string;
  ratio: string;
}


// ── PianoTiles JSON song format ─────────────────────────────────────────────
export interface PianoTilesSong {
  baseBpm: number;
  musics: PianoTilesMusic[];
  audition?: { start: number[]; end: number[] };
}

interface PianoTilesMusic {
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

// ── Duration tables ──────────────────────────────────────────────────────────

/**
 * Rest token letter → beat duration.
 * These are standalone tokens (e.g. "T", "U") that advance the timeline without creating a tile.
 *   Q=8  R=4  S=2  T=1  U=0.5  V=0.25  W=0.125  X=0.0625  Y=0.03125 beats
 * Multiple letters can be combined: "QR" = 12 beats, "TU" = 1.5 beats.
 */
const REST_BEATS: Record<string, number> = {
  Q: 8, R: 4, S: 2, T: 1, U: 0.5, V: 0.25, W: 0.125, X: 0.0625, Y: 0.03125,
};

/**
 * Bracket letter → beat duration (inside [...] after a note or chord).
 * Controls how long a tile is held and how much time advances after it.
 *   H=8  I=4  J=2  K=1  L=0.5  M=0.25  N=0.125  O=0.0625  P=0.03125 beats
 * Multiple letters can combine: "[KL]" = 1.5 beats, "[LM]" = 0.75 beats.
 */
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


// ── Token type system ────────────────────────────────────────────────────────
//
// Every token in a score string falls into exactly one of these categories.
// Adding support for a new token type means:
//   1. Add a label here (with ✓/✗ and description)
//   2. Add a case to classifyToken()
//   3. Add a handler function handleXxx()
//   4. Add a case to dispatchToken()
//
// Currently supported (✓) and known-unsupported (✗):
//
//   ✓ SIMPLE_NOTE   c1[L], #d2[M]          — single pitch, one tile, advances by bracketSlots
//   ✓ CHORD         (a1.b1)[L]             — multiple pitches, one tile slot, optional arpeggio
//   ✓ DOUBLE_GROUP  5<a[M],b[M]>           — two simultaneous tiles (pre-processed to __Dxx__)
//   ✓ REST          T, U, V, Q, R, W, X, Y — advance timeline, no tile produced
//   ✓ STOP          ST                     — special stop marker, advance 3 beats
//   ✗ UNKNOWN       anything else          — logs a warning, shows alert popup, skips token

type TokenType = 'SIMPLE_NOTE' | 'CHORD' | 'DOUBLE_GROUP' | 'REST' | 'STOP' | 'UNKNOWN';


// ── Parse context ────────────────────────────────────────────────────────────
//
// Passed into every handler instead of repeating individual parameters.
// currentSlot is the only field that changes; the rest are constant for a track.

interface ParseContext {
  currentSlot: number;
  bpm: number;
  baseBeats: number;
  slotDurationS: number;  // seconds per 1 slot = baseBeats * (60 / bpm)
  beatDurationS: number;  // seconds per 1 beat = 60 / bpm
  trackIndex: number;
  trackName: string;
  instrument: string;
}


// ── Handler return type ──────────────────────────────────────────────────────

interface TokenResult {
  notes: ParsedNote[];   // notes to add to the track (empty for rests/stop)
  slotsAdvanced: number; // how many slots to move currentSlot forward
}


// ── Token classification ─────────────────────────────────────────────────────

/**
 * Classify a single pre-processed token into its TokenType.
 * This is the single routing decision for the entire parse loop.
 */
function classifyToken(token: string): TokenType {
  // 5<> double groups were pre-processed into __Dxx__ placeholders
  if (token.startsWith('__D') && token.endsWith('__')) return 'DOUBLE_GROUP';

  // Stop marker — must check before REST since it starts with 'S'
  if (token === 'ST') return 'STOP';

  // Standalone rest letters only (no note letters, no brackets)
  // REST_BEATS covers Q R S T U V W X Y; multiple letters can combine (e.g. "TU")
  if (/^[QRSTUVWXY]+$/.test(token)) return 'REST';

  // Chord: token wrapped in parentheses, e.g. "(a1.b1)[L]" or "(#a1.#f2)[L]"
  if (token.startsWith('(')) return 'CHORD';

  // Simple note: starts with optional # then a note letter, followed by a bracket
  // Examples: "c1[L]", "#d2[M]", "e3[KL]"
  if (/^#?[a-gA-G]/.test(token) && /\[[HIJKLMNOP]+\]$/.test(token)) return 'SIMPLE_NOTE';

  return 'UNKNOWN';
}


// ── Arpeggio delay calculator ─────────────────────────────────────────────────
//
// Arpeggio operators sit between notes inside a chord or note sequence.
// They control how quickly successive notes are staggered in time (audio-only effect).
// The tile slot position (slotStart) is unaffected — only the audio `time` field changes.
//
// Operator reference:
//   .        — subtle stagger (dot articulation)
//   @ (x1)   — quick arpeggio across the full duration ÷ 10
//   @ (x2+)  — faster arpeggio: duration ÷ (10 × (count-1))
//   %        — moderate arpeggio: 30% of duration ÷ count
//   !        — slower arpeggio: 15% of duration ÷ count
//   ~ or $   — sweep arpeggio: duration ÷ (count+1)
//   ^ or &   — ornament/trill: very fast, fixed at beatDuration ÷ 24

function computeArpeggioDelay(
  opCounts: Record<string, number>,
  bracketSlots: number,
  beatDurationS: number,
  slotDurationS: number,
): number {
  const fullDurationS = bracketSlots * slotDurationS;

  if (opCounts['@'] > 0) {
    const count = opCounts['@'];
    return fullDurationS / (count === 1 ? 10 : 10 * (count - 1));
  }
  if (opCounts['%'] > 0) {
    return (3 * fullDurationS) / (10 * opCounts['%']);
  }
  if (opCounts['!'] > 0) {
    return (3 * fullDurationS) / (20 * opCounts['!']);
  }
  if (opCounts['~'] > 0 || opCounts['$'] > 0) {
    const count = opCounts['~'] + opCounts['$'];
    return fullDurationS / (count + 1);
  }
  if (opCounts['^'] > 0 || opCounts['&'] > 0) {
    return beatDurationS / 24;
  }
  // '.' operator or no operator: no stagger
  return 0;
}


// ── Token handlers ────────────────────────────────────────────────────────────
//
// Each handler is self-contained: it receives the raw token string + context,
// and returns the notes it produces plus how many slots to advance.
// None of them mutate ctx.currentSlot — the caller does that.

/**
 * STOP token ("ST").
 * Advances the timeline by 3 beats without producing a tile.
 * Hardcoded from the original PT2 engine behaviour.
 *
 * Example: score segment ending in "ST" to mark a held pause before the next phrase.
 */
function handleStop(ctx: ParseContext): TokenResult {
  return { notes: [], slotsAdvanced: 3 / ctx.baseBeats };
}

/**
 * REST token (e.g. "T", "U", "QR").
 * One or more rest letters that together advance the timeline by their combined beat value.
 * No tile is produced. Multiple letters can be concatenated: "TU" = 1.5 beats.
 *
 * Examples from Little Star bass: "c[L],g[L],T,e[L]" — the T rests 1 beat between notes.
 */
function handleRest(token: string, ctx: ParseContext): TokenResult {
  let restBeats = 0;
  for (const ch of token) restBeats += REST_BEATS[ch] ?? 0;
  return { notes: [], slotsAdvanced: restBeats / ctx.baseBeats };
}

/**
 * DOUBLE_GROUP token (placeholder "__Dxx__" produced by extractDoubleGroups).
 * Two or more notes share the same slotStart — they appear as side-by-side tiles.
 * Timeline advances by only ONE note's bracket duration (they're simultaneous).
 * All notes in the group are tagged with tileType: 'DOUBLE'.
 *
 * Original syntax: "5<g2[M],g2[M]>"
 * Examples from Jingle Bells difficulty 3: "5<g3[M],g3[M]>", "5<a2[M],a2[M]>"
 */
function handleDoubleGroup(
  placeholder: string,
  ctx: ParseContext,
  doubleGroupMap: Map<string, string[]>,
): TokenResult {
  const noteTokens = doubleGroupMap.get(placeholder) ?? [];
  if (noteTokens.length === 0) return { notes: [], slotsAdvanced: 0 };

  // All notes share the same slot advance (from the first note's bracket)
  const slotAdvance = parseBracketBeats(noteTokens[0], 0) / ctx.baseBeats;
  const bracketStr = noteTokens[0].match(/\[[HIJKLMNOP]+\]/)?.[0] ?? '';

  const notes: ParsedNote[] = [];
  for (const noteToken of noteTokens) {
    const rawName = noteToken.replace(/\[[^\]]*\]$/, '').trim();
    const parsed = parseNoteName(rawName);
    if (parsed) {
      notes.push({
        midi: parsed.midi,
        name: parsed.name,
        time: ctx.currentSlot * ctx.slotDurationS,
        duration: Math.max(slotAdvance * ctx.slotDurationS, 0.05),
        velocity: 0.7,
        trackIndex: ctx.trackIndex,
        trackName: ctx.trackName,
        channel: ctx.trackIndex,
        instrument: ctx.instrument,
        pt2Notation: rawName + bracketStr,
        slotStart: ctx.currentSlot,
        slotSpan: slotAdvance,
        tileType: 'DOUBLE',
      });
    }
  }

  return { notes, slotsAdvanced: Math.max(1, slotAdvance) };
}

/**
 * SIMPLE_NOTE token (e.g. "c1[L]", "#d2[M]", "e3[KL]").
 * One pitch + a bracket that defines tile height and timeline advance.
 * Produces a single ParsedNote with no arpeggio delay.
 *
 * Examples from Jingle Bells melody: "e3[L]", "g3[J]", "c3[K]"
 * Examples from Little Star bass:    "c[L]", "#f1[L]", "g[L]"
 */
function handleSimpleNote(token: string, ctx: ParseContext): TokenResult {
  const bracketBeats = parseBracketBeats(token, 0);
  const bracketSlots = bracketBeats / ctx.baseBeats;
  if (bracketSlots === 0) return { notes: [], slotsAdvanced: 0 };

  const rawName = token.replace(/\[[^\]]*\]$/, '').trim();
  const parsed = parseNoteName(rawName);
  if (!parsed) return { notes: [], slotsAdvanced: Math.max(1, bracketSlots) };

  const bracketStr = token.match(/\[[HIJKLMNOP]+\]/)?.[0] ?? '';
  const note: ParsedNote = {
    midi: parsed.midi,
    name: parsed.name,
    time: ctx.currentSlot * ctx.slotDurationS,
    duration: Math.max(bracketSlots * ctx.slotDurationS, 0.05),
    velocity: 0.7,
    trackIndex: ctx.trackIndex,
    trackName: ctx.trackName,
    channel: ctx.trackIndex,
    instrument: ctx.instrument,
    pt2Notation: rawName + bracketStr,
    slotStart: ctx.currentSlot,
    slotSpan: bracketSlots,
  };

  return { notes: [note], slotsAdvanced: Math.max(1, bracketSlots) };
}

/**
 * CHORD token (e.g. "(a1.b1)[L]", "(#a1.#f2)[L]", "(e1.g1.c2)[L]").
 * Multiple pitches inside parentheses share the same tile slot.
 * Arpeggio operators between note names (. @ % ! ~ $ ^ &) stagger the audio timing
 * of each note — this is audio-only and does NOT affect tile layout.
 *
 * The entire chord still advances the timeline by bracketSlots (same as a simple note).
 *
 * Examples from Little Star melody: "(e1.g1.c2)[L]", "(d2.g2)[L]", "(a1.e2.a2)[L]"
 */
function handleChord(token: string, ctx: ParseContext): TokenResult {
  const bracketBeats = parseBracketBeats(token, 0);
  const bracketSlots = bracketBeats / ctx.baseBeats;
  if (bracketSlots === 0) return { notes: [], slotsAdvanced: 0 };

  // Strip bracket, then strip outer parens to get the inner content
  const content = token.replace(/\[[^\]]*\]$/, '').trim();
  const inner = content.replace(/^\((.*)\)$/, '$1');

  // Extract note names and arpeggio operators from the inner content
  // Note names: optional # + letter + optional octave (e.g. "#a1", "g", "c2")
  // Operators:  . @ % ! ~ $ ^ &
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
    return { notes: [], slotsAdvanced: Math.max(1, bracketSlots) };
  }

  // Count arpeggio operators to compute the per-note stagger delay
  const opCounts: Record<string, number> = { '.': 0, '@': 0, '%': 0, '!': 0, '~': 0, '$': 0, '^': 0, '&': 0 };
  for (const op of ops) opCounts[op] = (opCounts[op] || 0) + 1;

  const delayS = computeArpeggioDelay(opCounts, bracketSlots, ctx.beatDurationS, ctx.slotDurationS);
  const bracketStr = token.match(/\[[HIJKLMNOP]+\]/)?.[0] ?? '';

  const notes: ParsedNote[] = [];
  let arpeggioAccumS = 0; // accumulated audio offset for each successive note

  for (let i = 0; i < notesToPlay.length; i++) {
    const rawName = notesToPlay[i];
    const parsed = parseNoteName(rawName);
    if (parsed) {
      notes.push({
        midi: parsed.midi,
        name: parsed.name,
        time: ctx.currentSlot * ctx.slotDurationS + arpeggioAccumS,
        duration: Math.max(bracketSlots * ctx.slotDurationS - arpeggioAccumS, 0.05),
        velocity: 0.7,
        trackIndex: ctx.trackIndex,
        trackName: ctx.trackName,
        channel: ctx.trackIndex,
        instrument: ctx.instrument,
        pt2Notation: rawName + bracketStr,
        slotStart: ctx.currentSlot,
        slotSpan: bracketSlots,
        arpeggioDelayS: arpeggioAccumS,
      });
    }
    // Each successive note is shifted further in time (last note gets no further shift)
    if (i < notesToPlay.length - 1) arpeggioAccumS += delayS;
  }

  return { notes, slotsAdvanced: Math.max(1, bracketSlots) };
}


// ── Token dispatcher ─────────────────────────────────────────────────────────

/**
 * Route a classified token to its handler. Returns the combined result.
 * UNKNOWN tokens return empty and are handled (warned) by the caller.
 */
function dispatchToken(
  type: TokenType,
  token: string,
  ctx: ParseContext,
  doubleGroupMap: Map<string, string[]>,
): TokenResult {
  switch (type) {
    case 'DOUBLE_GROUP': return handleDoubleGroup(token, ctx, doubleGroupMap);
    case 'STOP':         return handleStop(ctx);
    case 'REST':         return handleRest(token, ctx);
    case 'SIMPLE_NOTE':  return handleSimpleNote(token, ctx);
    case 'CHORD':        return handleChord(token, ctx);
    case 'UNKNOWN':      return { notes: [], slotsAdvanced: 0 };
  }
}


// ── Double group pre-processor ───────────────────────────────────────────────
//
// 5<note1,note2> groups contain commas which would break the normal token split.
// We extract them first, replacing each group with a unique placeholder.
// The main parse loop then handles placeholders as DOUBLE_GROUP tokens.

function extractDoubleGroups(score: string): {
  processed: string;
  doubleGroupMap: Map<string, string[]>;
} {
  const doubleGroupMap = new Map<string, string[]>();
  let idx = 0;

  const processed = score.replace(/5<([^>]*)>/g, (_m, inner: string) => {
    const key = `__D${idx++}__`;
    doubleGroupMap.set(key, inner.split(',').map((s: string) => s.trim()).filter(Boolean));
    return key;
  });

  return { processed, doubleGroupMap };
}


// ── Score string parser ──────────────────────────────────────────────────────

/**
 * Parse one PianoTiles score string into a flat list of ParsedNote events.
 *
 * Score format overview:
 *   - Tokens are comma-separated: "c1[L],e1[L],g[L]"
 *   - Semicolons ";" are phrase/measure separators (cosmetic in the source);
 *     we split on them first so the loop processes one musical phrase at a time.
 *   - Each token has a type (see TokenType above). The type determines which
 *     handler runs and how much the timeline advances.
 *
 * Timeline units:
 *   - currentSlot is the authoritative position counter (integer-ish, float for sub-beats)
 *   - slotDurationS converts slots to seconds for audio scheduling
 *   - 1 slot = baseBeats beats = (baseBeats × 60/bpm) seconds
 *
 * @param score       Raw score string from the JSON (one track, one music segment)
 * @param bpm         Tempo of this segment in beats-per-minute
 * @param baseBeats   How many beats make up one slot (typically 0.5 for most songs)
 * @param trackIndex  0 = Melody, 1 = Bass, 2+ = extra tracks
 * @param trackName   Human-readable label for debugging
 * @param instrument  Instrument name from the JSON (e.g. "piano")
 */
function parseScore(
  score: string,
  bpm: number,
  baseBeats: number,
  trackIndex: number,
  trackName: string,
  instrument: string,
): { notes: ParsedNote[]; totalSlots: number } {

  // ── Step 1: Pre-process 5<> double groups ──────────────────────────────────
  // Must happen before any splitting because 5<a[M],b[M]> contains a comma.
  const { processed, doubleGroupMap } = extractDoubleGroups(score);

  // ── Step 2: Strip structural noise ────────────────────────────────────────
  // N<...> groupings (e.g. "3<c1[L]>") are purely notational in PT2 — the
  // engine treats them identically to ungrouped notes. Strip the wrappers.
  // Effect blocks {n} are decorative and have no timing/tile effect.
  const cleaned = processed
    .replace(/\d+</g, '')   // remove N< openers (5< already extracted above)
    .replace(/>/g, '')      // remove > closers
    .replace(/\{[^}]*\}/g, ''); // remove {effect} blocks

  // ── Step 3: Build parse context (constant for this track) ─────────────────
  const beatDurationS = 60 / bpm;
  const slotDurationS = baseBeats * beatDurationS;

  // ── Step 4: Parse segments (split on ";") then tokens (split on ",") ──────
  // Semicolons delimit musical phrases. Melody and Bass tend to align at these
  // boundaries (both phrases sum to the same beat count), but we don't enforce
  // that here — each track advances its own independent currentSlot counter.
  const segments = cleaned.split(';');

  const notes: ParsedNote[] = [];
  const unknownTokens: string[] = [];
  let currentSlot = 0;

  for (const segment of segments) {
    const tokens = segment.split(',');

    for (let rawToken of tokens) {
      const token = rawToken.trim();
      if (!token) continue;

      const type = classifyToken(token);
      const ctx: ParseContext = {
        currentSlot,
        bpm,
        baseBeats,
        slotDurationS,
        beatDurationS,
        trackIndex,
        trackName,
        instrument,
      };

      if (type === 'UNKNOWN') {
        unknownTokens.push(token);
        continue;
      }

      const result = dispatchToken(type, token, ctx, doubleGroupMap);
      notes.push(...result.notes);
      currentSlot += result.slotsAdvanced;
    }
  }

  // ── Step 5: Report unknown tokens (once per track, not per token) ──────────
  if (unknownTokens.length > 0) {
    const unique = [...new Set(unknownTokens)];
    const msg = `[PianoTiles Parser] Unknown tokens in "${trackName}" — not yet supported:\n${unique.join(', ')}`;
    console.warn(msg);
    if (typeof window !== 'undefined') {
      window.alert(msg);
    }
  }

  return { notes, totalSlots: currentSlot };
}


// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a complete MidiParseResult from a PianoTiles song JSON.
 * This acts as the core engine translating the strict PT2 JSON format into the physical
 * Layout and Note data used by the React GameBoard and the Tone.js Synth.
 *
 * Process flow:
 * 1. Iterates over all `musics` segments (milestones) chronologically.
 * 2. Parses the literal bracket heights (e.g. [L] = 0.5 beats) and temporal delays into ParsedNotes.
 * 3. Applies a `ScrollSegment` mapping for each milestone since BPMs transition smoothly.
 * 4. Passes notes to `buildTilesFromNotes()` for mathematical grid-lane assignment and collision detection.
 * 5. Correlates Bass track accompaniment dots into Melody hold tiles, or promotes them to full tiles if during a rest.
 *
 * @param song               The parsed raw JSON tree of the PianoTiles 2 file.
 * @param musicIndex         The segment index to start parsing from (almost always 0 for endless mode).
 * @param songName           Human-readable name of the song used for the UI INFO Card.
 * @param audioScoreIndices  Which score array indices (e.g., [0, 1] for Melody + Bass) should be parsed into audio/tiles.
 * @returns                  A standardized MidiParseResult object consumed by `GameBoard` and `useSynth`.
 */
export function buildResultFromPianoTilesSong(
  song: PianoTilesSong,
  musicIndex = 0,
  songName = 'Unknown',
  audioScoreIndices: number[] = [0, 1],
  catalogEntry?: CatalogEntry
): MidiParseResult {
  const allNotes: ParsedNote[] = [];
  const allTiles: GameTile[] = [];
  const scrollSegments: ScrollSegment[] = [];

  let maxTrackCount = 0;
  let globalLastLane = -1;
  // Also propagate the last double-pair index across section boundaries.
  // Without this, the exclusion zone from a section-ending double pair only
  // covers laneA (stored in globalLastLane), not laneB — causing the first
  // tile of the next section to land on laneB and appear back-to-back.
  let globalLastDoublePairIdx = -1;

  let catBpms: number[] = [];
  let catBaseBeats: number[] = [];
  let catRatios: number[] = [];

  if (catalogEntry) {
    if (catalogEntry.bpm) catBpms = catalogEntry.bpm.split('|').map(Number);
    if (catalogEntry.baseBeat) catBaseBeats = catalogEntry.baseBeat.split('|').map(Number);
    if (catalogEntry.ratio) catRatios = catalogEntry.ratio.split('|').map(Number);
  }

  const initialMusic = song.musics[musicIndex] ?? song.musics[0];
  const initialBpm = catBpms[0] ?? initialMusic?.bpm ?? 100;
  const initialBaseBeat = catBaseBeats[0] ?? initialMusic?.baseBeats ?? 0.5;
  const initialEffectiveBpm = catRatios[0] ?? (initialBpm / initialBaseBeat);

  const START_OFFSET_SLOTS = 2;
  const MIN_HEIGHT = 100;
  const initialSlotDurationS = initialBpm > 0 ? (initialBaseBeat * (60 / initialBpm)) : 0.6;

  let currentSlotOffset = START_OFFSET_SLOTS;
  let currentTimeOffset = START_OFFSET_SLOTS * initialSlotDurationS;

  if (START_OFFSET_SLOTS > 0) {
    scrollSegments.push({
      startSlot: 0,
      endSlot: START_OFFSET_SLOTS,
      slotDurationS: initialSlotDurationS,
      startPixel: 0,
      endPixel: START_OFFSET_SLOTS * MIN_HEIGHT,
      startTime: 0,
      endTime: currentTimeOffset,
    });
  }

  song.musics.forEach((music, segmentIdx) => {
    // Rely on catalog arrays, fallback to current segment JSON, then fallback to last array element
    const bpm = catBpms[segmentIdx] ?? catBpms[catBpms.length - 1] ?? music.bpm;
    const baseBeats = catBaseBeats[segmentIdx] ?? catBaseBeats[catBaseBeats.length - 1] ?? music.baseBeats;
    const ratio = catRatios[segmentIdx] ?? catRatios[catRatios.length - 1] ?? (bpm / baseBeats);

    const { scores, instruments, alternatives } = music;
    const sectionNotes: ParsedNote[] = [];
    let maxSectionSlots = 0;

    if (scores.length > maxTrackCount) {
      maxTrackCount = scores.length;
    }

    scores.forEach((score, i) => {
      const trackName = i === 0 ? 'Melody' : i === 1 ? 'Bass' : `Track ${i + 1}`;
      const instr = (alternatives?.[i] || instruments?.[i] || 'piano').toLowerCase();
      const parsed = parseScore(score, bpm, baseBeats, i, trackName, instr);
      sectionNotes.push(...parsed.notes);
      if (parsed.totalSlots > maxSectionSlots) {
        maxSectionSlots = parsed.totalSlots;
      }
    });

    sectionNotes.sort((a, b) => a.time - b.time);

    // The precalculated ratio is essentially effectiveBpm.
    // mathematically: slotDurationS = 60 / ratio
    const slotDurationS = ratio > 0 ? (60 / ratio) : (baseBeats * (60 / bpm));

    const melodyNotes = sectionNotes.filter(
      n => n.trackIndex === 0 && audioScoreIndices.includes(n.trackIndex)
    );
    const accompNotes = sectionNotes.filter(
      n => n.trackIndex !== 0 && audioScoreIndices.includes(n.trackIndex)
    );

    const bassAccomp: typeof accompNotes = [];
    const bassTileNotes: typeof accompNotes = [];
    for (const bassNote of accompNotes) {
      const overlaps = melodyNotes.some(
        m => bassNote.slotStart >= m.slotStart && bassNote.slotStart < m.slotStart + m.slotSpan
      );
      if (overlaps) bassAccomp.push(bassNote);
      else bassTileNotes.push(bassNote);
    }

    const tileNotes = [...melodyNotes, ...bassTileNotes].sort((a, b) => a.time - b.time);
    const { tiles: sectionTiles, lastLane, lastDoublePairIdx } = buildTilesFromNotes(
      tileNotes,
      globalLastLane,
      globalLastDoublePairIdx,
    );
    globalLastLane = lastLane;
    globalLastDoublePairIdx = lastDoublePairIdx;

    const sortedTiles = [...sectionTiles].sort((a, b) => a.note.slotStart - b.note.slotStart);
    for (const accNote of bassAccomp) {
      for (const tile of sortedTiles) {
        if (accNote.slotStart >= tile.note.slotStart &&
          accNote.slotStart < tile.note.slotStart + tile.note.slotSpan) {
          tile.notes.push(accNote);
          break;
        }
      }
    }

    const sectionTotalSlots = Math.max(1, Math.round(maxSectionSlots));
    const sectionLayoutTimeS = sectionTotalSlots * slotDurationS;

    sectionNotes.forEach(n => {
      n.slotStart += currentSlotOffset;
      n.time += currentTimeOffset;
    });

    sectionTiles.forEach((tile) => {
      tile.slotStart += currentSlotOffset;
      tile.bottomOffset = Math.round(tile.slotStart) * MIN_HEIGHT;
      tile.height = Math.max(1, Math.round(tile.slotSpan)) * MIN_HEIGHT;
    });

    allNotes.push(...sectionNotes.filter(n => audioScoreIndices.includes(n.trackIndex)));
    allTiles.push(...sectionTiles);

    scrollSegments.push({
      startSlot: currentSlotOffset,
      endSlot: currentSlotOffset + sectionTotalSlots,
      slotDurationS,
      startPixel: Math.round(currentSlotOffset) * MIN_HEIGHT,
      endPixel: Math.round(currentSlotOffset + sectionTotalSlots) * MIN_HEIGHT,
      startTime: currentTimeOffset,
      endTime: currentTimeOffset + sectionLayoutTimeS,
    });

    currentSlotOffset += sectionTotalSlots;
    currentTimeOffset += sectionLayoutTimeS;
  });

  allNotes.sort((a, b) => a.time - b.time);

  const LAYOUT_PAD_TOP = 160;
  const currentBottomOffset = Math.round(currentSlotOffset) * MIN_HEIGHT;
  const finalTotalHeight = currentBottomOffset + LAYOUT_PAD_TOP;

  allTiles.forEach((tile, index) => {
    tile.id = `tile-${index}-${tile.note.midi}-${tile.slotStart}`;
    tile.top = finalTotalHeight - tile.bottomOffset - tile.height;
  });

  const durationSeconds =
    allNotes.length > 0
      ? allNotes[allNotes.length - 1].time + allNotes[allNotes.length - 1].duration
      : 0;

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
    notes: allNotes,
    tiles: allTiles,
    totalHeight: finalTotalHeight,
  };
}
