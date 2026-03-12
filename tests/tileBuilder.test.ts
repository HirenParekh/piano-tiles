import { describe, it, expect } from 'vitest';
import { buildTilesFromNotes } from '../src/utils/tileBuilder';

describe('tileBuilder.ts - Layout and Collision Engine', () => {
    it('merges simultaneous notes into a chord tile', () => {
        const notes = [
            { midi: 60, name: 'C4', time: 0, duration: 1, velocity: 1, trackIndex: 0, trackName: 'Melody', channel: 0, slotStart: 0, slotSpan: 1 },
            { midi: 64, name: 'E4', time: 0, duration: 1, velocity: 1, trackIndex: 0, trackName: 'Melody', channel: 0, slotStart: 0, slotSpan: 1 },
        ];

        const { tiles } = buildTilesFromNotes(notes);

        expect(tiles).toHaveLength(1); // Merged into 1 GameTile
        expect(tiles[0].notes).toHaveLength(2); // Retains both audio notes internally
        expect(tiles[0].slotStart).toBe(0);
        expect(tiles[0].slotSpan).toBe(1);
    });

    it('absorbs sequential notes into a Hold Tile span', () => {
        const notes = [
            // Primary long hold spanning slots 0-4
            { midi: 60, name: 'C4', time: 0, duration: 2, velocity: 1, trackIndex: 0, trackName: 'Melody', channel: 0, slotStart: 0, slotSpan: 4 },
            // Sub-note cascading purely inside slots 1-2
            { midi: 64, name: 'E4', time: 0.5, duration: 0.5, velocity: 1, trackIndex: 0, trackName: 'Melody', channel: 0, slotStart: 1, slotSpan: 1 },
        ];

        const { tiles } = buildTilesFromNotes(notes);

        expect(tiles).toHaveLength(1); // 1 active hold tile
        expect(tiles[0].notes).toHaveLength(2);
        expect(tiles[0].slotStart).toBe(0);
        expect(tiles[0].slotSpan).toBe(4); // Physical layout retains the total bound coverage
    });

    it('dynamically avoids lane collisions natively by slots', () => {
        const notes = [
            // Tile 1 sitting exactly in slot 0 taking 2.5 slots
            // NOTE: if duration is explicitly short we must make sure slotSpan is 0 or it tests for overlap explicitly natively over slotSpan span
            { midi: 60, name: 'C4', time: 0, duration: 2.5, velocity: 1, trackIndex: 0, trackName: 'Melody', channel: 0, slotStart: 0, slotSpan: 2.5 },
            // Tile 2 appearing at slot 3 taking 1 slot. 
            // It MUST NOT combine with Tile 1
            { midi: 64, name: 'E4', time: 3, duration: 1, velocity: 1, trackIndex: 0, trackName: 'Melody', channel: 0, slotStart: 3, slotSpan: 1 },
        ];

        const { tiles } = buildTilesFromNotes(notes);

        expect(tiles).toHaveLength(2); // They do not overlap slotStart so they remain 2 disjoint physical tiles
        expect(tiles[0].lane).not.toBe(tiles[1].lane); // Force collision logic works
    });
});
