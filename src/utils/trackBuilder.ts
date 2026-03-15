import type { GameTile } from '../types/midi';
import type { GameTrackData, Card, Tile } from '../types/track';

export function buildTrackFromTiles(tiles: GameTile[]): GameTrackData {
    // 1. Map old GameTile array to new Card-based Tile array with absolute track rows
    const absTiles = tiles.map(t => {
        const isDouble = t.notes.length > 0 && t.notes[0].tileType === 'DOUBLE';
        const rowStart = Math.round(t.slotStart);
        const rowSpan = Math.max(1, Math.round(t.slotSpan));
        const isHold = rowSpan > 1;

        const base: any = {
            id: t.id,
            lane: t.lane,
            absRowStart: rowStart + 2, // Shift 2 rows up to make room for Info & Start inline
            rowSpan,
            notes: t.notes,
            tapped: t.tapped,
            noteIndices: t.noteIndices,
        };

        if (isDouble) {
            base.type = 'DOUBLE';
        } else if (isHold) {
            base.type = 'HOLD';
            base.isActive = false;
            base.isCompleted = false;
        } else {
            base.type = 'SINGLE';
        }

        return base;
    });

    // Sort strictly by starting row
    absTiles.sort((a, b) => a.absRowStart - b.absRowStart);

    // Assign shared pairNotes to adjacent DOUBLE tile pairs (same absRowStart).
    // Both tiles get the same array reference so useTileAudio can key by it.
    for (let k = 0; k < absTiles.length - 1; k++) {
        const a = absTiles[k];
        const b = absTiles[k + 1];
        if (a.type === 'DOUBLE' && b.type === 'DOUBLE' && a.absRowStart === b.absRowStart) {
            const pairNotes = [a.notes[0], b.notes[0]];
            a.pairNotes = pairNotes;
            b.pairNotes = pairNotes;
            k++; // both tiles handled, skip b
        }
    }

    const maxRow = absTiles.length > 0
        ? Math.max(...absTiles.map(t => t.absRowStart + t.rowSpan))
        : 0;

    const cards: Card[] = [];
    let currentRow = 0;
    let i = 0;

    // 2. Iterate up the track and chunk tiles into span-appropriate Cards
    while (currentRow < maxRow || i < absTiles.length) {
        if (currentRow === 0) {
            // Put the Info card exactly at row 0 (span 1), Start tile at row 1 (span 1)
            cards.push({ id: 'card-info', type: 'INFO', span: 1, title: 'Unknown Song', author: 'Unknown Author' });
            cards.push({ id: 'card-start', type: 'START', span: 1 });
            currentRow = 2;
            continue;
        }

        if (i < absTiles.length && absTiles[i].absRowStart > currentRow) {
            // Gap in the music. Fill with an Empty Card.
            const gapSpan = absTiles[i].absRowStart - currentRow;
            cards.push({ id: `empty-${currentRow}`, type: 'EMPTY', span: gapSpan });
            currentRow += gapSpan;
        } else if (i < absTiles.length) {
            // We have tiles starting at exactly currentRow. Find how far this 'block' extends.
            let blockStart = currentRow;
            let blockEnd = blockStart + 1; // Minimum 1 row span

            let j = i;
            // Expand the blockEnd to encompass any hold-tiles starting within the block
            while (j < absTiles.length && absTiles[j].absRowStart < blockEnd) {
                const tileEnd = absTiles[j].absRowStart + absTiles[j].rowSpan;
                if (tileEnd > blockEnd) {
                    blockEnd = tileEnd;
                }
                j++;
            }

            const blockSpan = blockEnd - blockStart;

            // Extract the tiles and localize their rowStart relative to this specific Card
            const blockTiles = absTiles.slice(i, j).map(t => {
                const localizedStart = t.absRowStart - blockStart;
                const serialized = { ...t, rowStart: localizedStart };
                delete serialized.absRowStart;
                return serialized as Tile;
            });

            cards.push({
                id: `tile-card-${blockStart}`,
                type: 'TILE',
                span: blockSpan,
                tiles: blockTiles,
            });

            i = j;
            currentRow = blockEnd;
        } else {
            break;
        }
    }

    // 3. Append the Finish Line card after all notes are completed
    cards.push({ id: 'card-finish', type: 'FINISH', span: 2 });
    currentRow += 2;

    // Render an extra empty buffer at the very top so the final blocks scroll smoothly off screen
    cards.push({ id: 'card-buffer', type: 'EMPTY', span: 6 });
    currentRow += 6;

    return {
        cards,
        totalRows: currentRow,
    };
}
