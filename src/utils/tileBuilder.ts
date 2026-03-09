import type {
    ParsedNote,
    GameTile,
    InstrumentCategory,
} from '../types/midi';

const LANE_COUNT = 4;

export const MIN_HEIGHT = 100;
const LAYOUT_PAD_TOP = 160;

const KEYBOARD_KEYWORDS =
    /piano|keyboard|keys|grand|upright|electric\s*pno|synth\s*keys|organ|harpsichord|clavi|vibes|marimba|xylophone|celesta/i;

export function getInstrumentCategory(program: number | null): InstrumentCategory {
    if (program === null) return 'other';
    if (program >= 0 && program <= 7) return 'piano';
    if (program >= 8 && program <= 23) return 'keyboard';
    return 'other';
}

export function isKeyboardByName(name: string): boolean {
    return KEYBOARD_KEYWORDS.test(name);
}

function mergeConsecutiveNotes(notes: ParsedNote[]): ParsedNote[][] {
    const groups: ParsedNote[][] = [];
    let i = 0;
    while (i < notes.length) {
        const group = [notes[i]];
        const startSlot = group[0].slotStart;

        while (i + group.length < notes.length) {
            const next = notes[i + group.length];
            if (next.slotStart === startSlot) {
                group.push(next);
            } else {
                break;
            }
        }

        while (i + group.length < notes.length) {
            const next = notes[i + group.length];

            let maxEndSlot = startSlot;
            for (const n of group) {
                if (n.slotStart + n.slotSpan > maxEndSlot) {
                    maxEndSlot = n.slotStart + n.slotSpan;
                }
            }

            if (next.slotStart < maxEndSlot) {
                group.push(next);
            } else {
                break;
            }
        }

        groups.push(group);
        i += group.length;
    }
    return groups;
}

function buildLayout(tiles: GameTile[]): number {
    for (const tile of tiles) {
        let maxEndSlot = tile.note.slotStart;
        for (const n of tile.notes) {
            if (n.slotStart + n.slotSpan > maxEndSlot) {
                maxEndSlot = n.slotStart + n.slotSpan;
            }
        }
        const slotSpan = maxEndSlot - tile.note.slotStart;
        tile.slotSpan = slotSpan;
        tile.height = Math.max(1, Math.round(slotSpan)) * MIN_HEIGHT;
    }

    let maxEndRow = 0;
    for (const tile of tiles) {
        tile.bottomOffset = Math.round(tile.slotStart) * MIN_HEIGHT;
        const endRow = Math.round(tile.slotStart) + Math.max(1, Math.round(tile.slotSpan));
        if (endRow > maxEndRow) maxEndRow = endRow;
    }

    const totalHeight = maxEndRow * MIN_HEIGHT + LAYOUT_PAD_TOP;

    for (const tile of tiles) {
        tile.top = totalHeight - tile.bottomOffset - tile.height;
    }

    return totalHeight;
}

export function buildTilesFromNotes(
    notes: ParsedNote[],
    initialLastLane?: number,
): { tiles: GameTile[]; totalHeight: number; lastLane: number } {
    const groups = mergeConsecutiveNotes(notes);

    let noteOffset = 0;
    let lastLane = initialLastLane ?? -1;
    const tiles: GameTile[] = groups.map((group, index) => {
        const primaryNote = group[0];

        let lane = Math.floor(Math.random() * LANE_COUNT);
        if (lane === lastLane) {
            lane = (lane + 1) % LANE_COUNT;
        }
        lastLane = lane;

        const noteIndices = Array.from({ length: group.length }, (_, j) => noteOffset + j + 1);
        noteOffset += group.length;
        return {
            id: `tile-${index}-${primaryNote.midi}-${primaryNote.slotStart}`,
            note: primaryNote,
            notes: group,
            noteIndices,
            lane,
            tapped: false,
            height: 0,
            bottomOffset: 0,
            top: 0,
            slotStart: primaryNote.slotStart,
            slotSpan: 1,
        };
    });

    const laneEndSlots = [0, 0, 0, 0];

    for (const tile of tiles) {
        const startSlot = tile.slotStart;
        let endSlot = startSlot;
        for (const n of tile.notes) {
            if (n.slotStart + n.slotSpan > endSlot) {
                endSlot = n.slotStart + n.slotSpan;
            }
        }

        if (startSlot < laneEndSlots[tile.lane]) {
            const candidates = [0, 1, 2, 3]
                .filter(l => l !== tile.lane)
                .sort((a, b) => laneEndSlots[a] - laneEndSlots[b]);

            for (const candidate of candidates) {
                if (startSlot >= laneEndSlots[candidate]) {
                    tile.lane = candidate;
                    break;
                }
            }
        }

        laneEndSlots[tile.lane] = Math.max(laneEndSlots[tile.lane], endSlot);
    }

    const totalHeight = buildLayout(tiles);
    return { tiles, totalHeight, lastLane };
}
