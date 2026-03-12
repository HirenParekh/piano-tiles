import { describe, it, expect } from 'vitest';
import { parsePianoTilesNotes } from '../src/utils/pianoTilesParser';

describe('pianoTilesParser.ts - Core Note Tokenization', () => {
    it('parses single notes with basic exact durations', () => {
        // 1 beat = [K], 0.5 beat = [L]
        const song = {
            baseBpm: 120,
            musics: [{
                id: 1, bpm: 120, baseBeats: 1,
                scores: ["c1[K], d1[L], e1[M]"] // [K]=1, [L]=0.5, [M]=0.25 (when baseBeats=1)
            }]
        };

        const { notes } = parsePianoTilesNotes(song);

        expect(notes).toHaveLength(3);

        // C4 matches [K] -> 1 slotSpan exactly
        expect(notes[0].name).toBe('C4');
        expect(notes[0].slotStart).toBe(0);
        expect(notes[0].slotSpan).toBe(1);

        // D4 matches [L] -> 0.5 slotSpan
        expect(notes[1].name).toBe('D4');
        expect(notes[1].slotStart).toBe(1);
        expect(notes[1].slotSpan).toBe(0.5);

        // E4 matches [M] -> 0.25 slotSpan
        expect(notes[2].name).toBe('E4');
        expect(notes[2].slotStart).toBe(1.5);
        expect(notes[2].slotSpan).toBe(0.25);
    });

    it('calculates rest padding correctly', () => {
        // T = 1 rest
        const song = {
            baseBpm: 60,
            musics: [{
                id: 1, bpm: 60, baseBeats: 1,
                scores: ["T, e1[K]"]
            }]
        };
        const { notes } = parsePianoTilesNotes(song);
        expect(notes).toHaveLength(1);
        expect(notes[0].name).toBe('E4');
        // First slot skipped correctly by the "T" rest
        expect(notes[0].slotStart).toBe(1);
        expect(notes[0].slotSpan).toBe(1);
    });

    it('parses arpeggiated overlapping notes', () => {
        const song = {
            baseBpm: 120,
            musics: [{
                id: 1, bpm: 120, baseBeats: 1,
                scores: ["(c1@e1@g1)[K]"]
            }]
        };
        const { notes } = parsePianoTilesNotes(song);
        expect(notes).toHaveLength(3);

        // All arpeggios MUST start on the exact same theoretical Layout slot
        expect(notes[0].slotStart).toBe(0);
        expect(notes[1].slotStart).toBe(0);
        expect(notes[2].slotStart).toBe(0);

        // But audio timing should cascade slightly forward
        expect(notes[0].arpeggioDelayS).toBe(0);
        expect(notes[1].arpeggioDelayS as number).toBeGreaterThan(0);
        expect(notes[2].arpeggioDelayS as number).toBeGreaterThan(notes[1].arpeggioDelayS as number);
    });
});
