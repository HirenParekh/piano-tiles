import { NoteData } from '../types/midi';

const BRACKET_MAP = [
  { char: 'H', rest: 'Q', beats: 8 },
  { char: 'I', rest: 'R', beats: 4 },
  { char: 'J', rest: 'S', beats: 2 },
  { char: 'K', rest: 'T', beats: 1 },
  { char: 'L', rest: 'U', beats: 0.5 },
  { char: 'M', rest: 'V', beats: 0.25 },
  { char: 'N', rest: 'W', beats: 0.125 },
  { char: 'O', rest: 'X', beats: 0.0625 },
  { char: 'P', rest: 'Y', beats: 0.03125 },
];

const NOTE_NAMES = ['c', '#c', 'd', '#d', 'e', 'f', '#f', 'g', '#g', 'a', '#a', 'b'];

/** Converts MIDI number to PT2 pitch string (e.g. 60 -> "c1") */
function midiToPitch(midi: number): string {
  const octave = Math.floor(midi / 12) - 4;
  const offset = midi % 12;
  const name = NOTE_NAMES[offset];
  return octave === 0 ? name : `${name}${octave}`;
}

/** Greedy algorithm to convert beat duration into PT2 notation characters */
function calculateNotation(beats: number, isRest: boolean): string {
  let remaining = beats;
  let result = '';
  const threshold = 0.01;

  for (const item of BRACKET_MAP) {
    while (remaining >= item.beats - threshold) {
      result += isRest ? item.rest : item.char;
      remaining -= item.beats;
      if (remaining < threshold) break;
    }
  }

  if (!isRest && result) return `[${result}]`;
  return result;
}

export interface ExportResult {
  json: string;
  metadata: {
    [trackIdx: number]: {
      [barIdx: number]: {
        token: string;
        noteId: string | null;
      }[]
    }
  }
}

/**
 * Generates a full PianoTiles 2 JSON object with metadata for interactive debugging.
 */
export function generateProductionJson(
  notes: NoteData[], 
  bpm: number, 
  baseBeats: number,
  startBar: number = 1,
  endBar?: number
): ExportResult {
  const BEATS_PER_BAR = 4;
  const startBeat = (startBar - 1) * BEATS_PER_BAR;
  const endBeat = endBar ? endBar * BEATS_PER_BAR : Infinity;

  const tracksLayout: Record<number, NoteData[]> = {};
  notes.forEach(n => {
    const startBeats = n.start * (bpm / 60);
    if (startBeats >= startBeat && startBeats < endBeat) {
      const tid = n.trackIndex ?? 0;
      if (!tracksLayout[tid]) tracksLayout[tid] = [];
      tracksLayout[tid].push(n);
    }
  });

  const trackIds = Object.keys(tracksLayout).map(Number).sort((a, b) => a - b);
  const finalScores: string[] = [];
  const metadata: ExportResult['metadata'] = {};

  trackIds.forEach(tid => {
    const trackNotes = [...tracksLayout[tid]].sort((a, b) => a.start - b.start);
    const events: { startBeats: number, durationBeats: number, pitches: number[], notes: NoteData[] }[] = [];
    
    trackNotes.forEach(n => {
        const sB = n.start * (bpm / 60);
        const dB = n.duration * (bpm / 60);
        const existing = events.find(e => Math.abs(e.startBeats - sB) < 0.01);
        if (existing) {
            existing.pitches.push(n.pitch);
            existing.notes.push(n);
        } else {
            events.push({ startBeats: sB, durationBeats: dB, pitches: [n.pitch], notes: [n] });
        }
    });

    const actualEndBeat = endBar ? endBeat : (events.length > 0 ? Math.max(...events.map(e => e.startBeats + e.durationBeats)) : startBeat + 4);
    const lastBar = Math.ceil(actualEndBeat / BEATS_PER_BAR);
    
    const trackMetadata: typeof metadata[0] = {};
    let scoreStr = "";

    for (let bar = startBar; bar <= lastBar; bar++) {
      const barStart = (bar - 1) * BEATS_PER_BAR;
      const barEnd = bar * BEATS_PER_BAR;
      const barEvents = events.filter(e => e.startBeats >= barStart - 0.01 && e.startBeats < barEnd - 0.01);
      
      const barTokens: { token: string, noteId: string | null }[] = [];
      let barPos = barStart;

      barEvents.forEach((event, idx) => {
        const gap = event.startBeats - barPos;
        if (gap > 0.02) {
          barTokens.push({ token: calculateNotation(gap, true), noteId: null });
        }

        let tokenStr = "";
        if (event.pitches.length > 1) {
          tokenStr = `(${[...event.pitches].sort((a,b)=>a-b).map(midiToPitch).join('.')})${calculateNotation(event.durationBeats, false)}`;
        } else {
          tokenStr = `${midiToPitch(event.pitches[0])}${calculateNotation(event.durationBeats, false)}`;
        }
        barTokens.push({ token: tokenStr, noteId: event.notes[0].id });
        barPos = event.startBeats + event.durationBeats;
      });

      const trailingGap = barEnd - barPos;
      if (trailingGap > 0.02) {
        barTokens.push({ token: calculateNotation(trailingGap, true), noteId: null });
      }

      trackMetadata[bar] = barTokens;
      
      // Build score string for this bar
      const barSegment = barTokens.map((t, i) => {
        const isNextSep = (i < barTokens.length - 1);
        return t.token + (isNextSep ? "," : "");
      }).join("");
      scoreStr += barSegment + ";";
    }

    finalScores.push(scoreStr);
    metadata[tid] = trackMetadata;
  });

  const result = {
    baseBpm: bpm,
    musics: [
      { id: 1, bpm, baseBeats, scores: finalScores },
      { id: 2, bpm, baseBeats, scores: finalScores.map(() => "") },
      { id: 3, bpm, baseBeats, scores: finalScores.map(() => "") }
    ]
  };

  return {
    json: JSON.stringify(result, null, 2),
    metadata
  };
}
