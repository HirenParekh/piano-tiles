/**
 * tileTypeClassification.test.ts
 *
 * Tests the full pipeline from PT2 JSON song → parsed GameTile[] → tile type classification.
 *
 * Classification rule (classifyTile):
 *   DOUBLE  — tile.note.tileType === 'DOUBLE'  (5<> parser prefix)
 *   HOLD    — tile.slotSpan > 1                (bracket beats ÷ baseBeats > 1)
 *   SINGLE  — everything else
 *
 * Key insight: slotSpan > 1 is the hold signal, NOT notes.length > 1.
 * A chord tile (e.g. (e1.g1)[L]) can have notes.length=2 but slotSpan=1 → SINGLE.
 *
 * Bass track behaviour: bass notes that overlap a melody tile's slot range are
 * absorbed into that tile as chord notes (not their own tile). Bass notes that
 * fall in free slots become their own tile.
 */

import { describe, it, expect } from 'vitest';
import { buildResultFromPianoTilesSong } from '../../src/utils/pianoTilesParser';
import { classifyTile } from '../../src/game/tile-objects/classifyTile';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Classify every tile in a parsed song and return the type strings. */
function classifyAll(song: object) {
    const { tiles } = buildResultFromPianoTilesSong(song);
    return tiles.map(t => classifyTile(t));
}

// ---------------------------------------------------------------------------
// User-provided examples (baseBeats=0.5 → [L]=1 slot, [K]=2 slots)
// ---------------------------------------------------------------------------

describe('PT2 song JSON → tile type classification', () => {

    it('c2[L] melody + c[L] bass at same slot → 1 SINGLE tile (bass absorbed as chord note)', () => {
        // Both tracks at slot 0 → bass overlaps melody → merged into 1 tile with 2 notes.
        // slotSpan = 0.5/0.5 = 1 → SINGLE.
        const song = {
            baseBpm: 90,
            musics: [{ id: 1, bpm: 90, baseBeats: 0.5, scores: ['c2[L]', 'c[L]'] }],
        };
        const types = classifyAll(song);
        expect(types).toHaveLength(1);
        expect(types[0]).toBe('SINGLE');

        const { tiles } = buildResultFromPianoTilesSong(song);
        expect(tiles[0].notes).toHaveLength(2); // c2 melody + c bass merged
        expect(tiles[0].slotSpan).toBe(1);
    });

    it('c2[L] melody + U rest in bass track → 1 SINGLE tile (rest produces no tile)', () => {
        // U is a rest — advances timeline but creates no note or tile.
        const song = {
            baseBpm: 90,
            musics: [{ id: 1, bpm: 90, baseBeats: 0.5, scores: ['c2[L]', 'U'] }],
        };
        const types = classifyAll(song);
        expect(types).toHaveLength(1);
        expect(types[0]).toBe('SINGLE');
    });

    it('c2[K] melody + c[L],g1[L] bass → 1 HOLD tile (both bass notes fall inside the 2-slot hold)', () => {
        // c2[K]: slotSpan = 1/0.5 = 2 → HOLD.
        // c[L] at slot 0 and g1[L] at slot 1 both fall inside slot range [0, 2) → absorbed.
        const song = {
            baseBpm: 90,
            musics: [{ id: 1, bpm: 90, baseBeats: 0.5, scores: ['c2[K]', 'c[L],g1[L]'] }],
        };
        const types = classifyAll(song);
        expect(types).toHaveLength(1);
        expect(types[0]).toBe('HOLD');

        const { tiles } = buildResultFromPianoTilesSong(song);
        expect(tiles[0].slotSpan).toBe(2);
        expect(tiles[0].notes.length).toBeGreaterThanOrEqual(1); // primary + absorbed bass notes
    });

    it('melody [L] + non-overlapping bass [L] → 2 SINGLE tiles', () => {
        // c2 at slot 0, bass c at slot 1 — no overlap → each becomes its own tile.
        const song = {
            baseBpm: 90,
            musics: [{ id: 1, bpm: 90, baseBeats: 0.5, scores: ['c2[L],U', 'U,c[L]'] }],
        };
        const types = classifyAll(song);
        expect(types).toHaveLength(2);
        expect(types).toEqual(['SINGLE', 'SINGLE']);
    });

});

// ---------------------------------------------------------------------------
// classifyTile — unit tests (no parser, no Phaser)
// ---------------------------------------------------------------------------

describe('classifyTile', () => {

    /** Minimal GameTile stub — only the fields classifyTile reads. */
    function makeTile(slotSpan: number, tileType?: 'DOUBLE') {
        return {
            id: 'test',
            note: { slotSpan, tileType } as any,
            notes: [{ slotSpan }] as any,
            noteIndices: [0],
            lane: 0,
            tapped: false,
            height: slotSpan * 100,
            bottomOffset: 0,
            top: 0,
            slotStart: 0,
            slotSpan,
        };
    }

    it('slotSpan=1, single note → SINGLE', () => {
        expect(classifyTile(makeTile(1))).toBe('SINGLE');
    });

    it('slotSpan=1, chord (notes.length > 1) → still SINGLE', () => {
        // This was the bug: notes.length > 1 wrongly produced HOLD.
        // Classification must use slotSpan, not notes.length.
        const tile = makeTile(1);
        tile.notes = [tile.note, tile.note]; // simulate 2-note chord
        expect(classifyTile(tile)).toBe('SINGLE');
    });

    it('slotSpan=2 ([K] with baseBeats=0.5) → HOLD', () => {
        expect(classifyTile(makeTile(2))).toBe('HOLD');
    });

    it('slotSpan=4 ([J] with baseBeats=0.5) → HOLD', () => {
        expect(classifyTile(makeTile(4))).toBe('HOLD');
    });

    it('slotSpan=2 chord → HOLD (tall chord is still a hold)', () => {
        const tile = makeTile(2);
        tile.notes = [tile.note, tile.note];
        expect(classifyTile(tile)).toBe('HOLD');
    });

    it('tileType DOUBLE overrides slotSpan → DOUBLE', () => {
        expect(classifyTile(makeTile(1, 'DOUBLE'))).toBe('DOUBLE');
    });

    it('tileType DOUBLE with slotSpan=2 → still DOUBLE (DOUBLE wins)', () => {
        expect(classifyTile(makeTile(2, 'DOUBLE'))).toBe('DOUBLE');
    });

    it('[L] note with baseBeats=1 → slotSpan=0.5 → SINGLE', () => {
        // baseBeats=1 → [L]=0.5 beats → slotSpan=0.5 < 1 → SINGLE
        expect(classifyTile(makeTile(0.5))).toBe('SINGLE');
    });

    it('[K] note with baseBeats=1 → slotSpan=1 → SINGLE (exactly 1 slot tall)', () => {
        // baseBeats=1 → [K]=1 beat → slotSpan=1 → SINGLE
        expect(classifyTile(makeTile(1))).toBe('SINGLE');
    });

    it('[J] note with baseBeats=1 → slotSpan=2 → HOLD', () => {
        // baseBeats=1 → [J]=2 beats → slotSpan=2 → HOLD
        expect(classifyTile(makeTile(2))).toBe('HOLD');
    });

});
