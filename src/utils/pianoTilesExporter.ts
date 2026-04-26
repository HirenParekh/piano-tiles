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

const NOTE_NAMES_LOWER = ['c', '#c', 'd', '#d', 'e', 'f', '#f', 'g', '#g', 'a', '#a', 'b'];
const NOTE_NAMES_UPPER = ['C', '#C', 'D', '#D', 'E', 'F', '#F', 'G', '#G', 'A', '#A', 'B'];

/**
 * Converts MIDI number to PT2 pitch string matching the sim-pt2 pitch table exactly:
 * - Negative octaves: UPPERCASE + negative number  (e.g. midi 29 -> "F-2")
 * - Octave 0:        lowercase, no number          (e.g. midi 48 -> "c")
 * - Positive octaves: lowercase + positive number  (e.g. midi 60 -> "c1")
 */
export function midiToPitch(midi: number): string {
  // PT2 middle-C (c1) = MIDI 60 → octave = Math.floor(60/12) - 4 = 1
  // PT2 "c" (octave 0) = MIDI 48
  // PT2 negative octaves: octave < 0
  const octave = Math.floor(midi / 12) - 4;
  const offset = midi % 12;

  if (octave < 0) {
    // Uppercase for negative octaves: e.g. "F-2", "#G-1"
    const name = NOTE_NAMES_UPPER[offset];
    return `${name}${octave}`;
  } else if (octave === 0) {
    return NOTE_NAMES_LOWER[offset];
  } else {
    return `${NOTE_NAMES_LOWER[offset]}${octave}`;
  }
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

      let i = 0;
      while (i < barEvents.length) {
        const event = barEvents[i];
        const gap = event.startBeats - barPos;
        
        if (gap > 0.02) {
          barTokens.push({ token: calculateNotation(gap, true), noteId: null });
        }

        // --- Double Tile Check ---
        // Rule: Only Melody track (tid === 0), duration < baseBeats, back-to-back notes, group first two
        if (tid === 0 && event.durationBeats < baseBeats - 0.01) {
          if (i + 1 < barEvents.length) {
            const nextEvent = barEvents[i + 1];
            const nextGap = Math.abs(nextEvent.startBeats - (event.startBeats + event.durationBeats));
            
            if (nextGap < 0.02 && nextEvent.durationBeats < baseBeats - 0.01) {
              // Group them into a Double Tile!
              let t1 = "";
              if (event.pitches.length > 1) {
                t1 = `(${[...event.pitches].sort((a,b)=>a-b).map(midiToPitch).join('.')})${calculateNotation(event.durationBeats, false)}`;
              } else {
                t1 = `${midiToPitch(event.pitches[0])}${calculateNotation(event.durationBeats, false)}`;
              }
              
              let t2 = "";
              if (nextEvent.pitches.length > 1) {
                t2 = `(${[...nextEvent.pitches].sort((a,b)=>a-b).map(midiToPitch).join('.')})${calculateNotation(nextEvent.durationBeats, false)}`;
              } else {
                t2 = `${midiToPitch(nextEvent.pitches[0])}${calculateNotation(nextEvent.durationBeats, false)}`;
              }
              
              const combinedToken = `5<${t1},${t2}>`;
              barTokens.push({ token: combinedToken, noteId: event.notes[0].id });
              
              barPos = nextEvent.startBeats + nextEvent.durationBeats;
              i += 2; // Skip the next event since we consumed it
              continue;
            }
          }
        }

        // --- Normal Single Tile ---
        let tokenStr = "";
        if (event.pitches.length > 1) {
          tokenStr = `(${[...event.pitches].sort((a,b)=>a-b).map(midiToPitch).join('.')})${calculateNotation(event.durationBeats, false)}`;
        } else {
          tokenStr = `${midiToPitch(event.pitches[0])}${calculateNotation(event.durationBeats, false)}`;
        }
        barTokens.push({ token: tokenStr, noteId: event.notes[0].id });
        barPos = event.startBeats + event.durationBeats;
        
        i++;
      }

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

  // --- Split bars equally across 3 music objects ---
  // Re-derive the full bar range so we can slice per-music.
  const allTrackIds = Object.keys(tracksLayout).map(Number).sort((a, b) => a - b);
  const firstBar = startBar;

  // Compute lastBar across all tracks
  let globalLastBar = firstBar;
  allTrackIds.forEach(tid => {
    const trackNotes = tracksLayout[tid];
    trackNotes.forEach(n => {
      const endBeatN = (n.start + n.duration) * (bpm / 60);
      const barN = Math.ceil(endBeatN / BEATS_PER_BAR);
      if (barN > globalLastBar) globalLastBar = barN;
    });
  });
  if (endBar && endBar < globalLastBar) globalLastBar = endBar;

  const totalBars = globalLastBar - firstBar + 1;
  const barsPerMusic = Math.ceil(totalBars / 3);

  // Slice function: given a per-track score string and metadata, extract only the bars for [chunkStart, chunkEnd]
  function sliceScoreForChunk(
    tid: number,
    chunkStartBar: number,
    chunkEndBar: number
  ): string {
    const trackMeta = metadata[tid];
    if (!trackMeta) return "";

    let chunkScore = "";
    for (let bar = chunkStartBar; bar <= chunkEndBar; bar++) {
      const barTokens = trackMeta[bar] || [];
      const barSegment = barTokens.map((t, i) => {
        const isNextSep = (i < barTokens.length - 1);
        return t.token + (isNextSep ? "," : "");
      }).join("");
      chunkScore += barSegment + ";";
    }
    return chunkScore;
  }

  // Build 3 music objects, each covering 1/3 of the bars
  const musicObjects = [1, 2, 3].map((musicId, chunkIdx) => {
    const chunkStartBar = firstBar + chunkIdx * barsPerMusic;
    const chunkEndBar = Math.min(firstBar + (chunkIdx + 1) * barsPerMusic - 1, globalLastBar);
    const chunkScores = trackIds.map(tid => sliceScoreForChunk(tid, chunkStartBar, chunkEndBar));
    return { id: musicId, bpm, baseBeats, scores: chunkScores };
  });

  const result = {
    baseBpm: bpm,
    musics: musicObjects
  };

  return {
    json: JSON.stringify(result, null, 2),
    metadata
  };
}
