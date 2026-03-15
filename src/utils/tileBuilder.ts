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
            // Compare slots with a tiny tolerance due to floating point math (e.g., 0.1 + 0.2 != 0.3)
            if (Math.abs(next.slotStart - startSlot) < 0.0001) {
                // DOUBLE notes must stay as separate tiles — never merge them
                if (next.tileType === 'DOUBLE' || group[0].tileType === 'DOUBLE') break;
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

            // Only absorb subsequent notes that fall explicitly strictly INSIDE the current hold.
            // DOUBLE notes must never be absorbed — they always stay as their own tile.
            if (next.tileType !== 'DOUBLE' && group[0].tileType !== 'DOUBLE' && next.slotStart < maxEndSlot - 0.0001) {
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
    // Track last double pair: 0 = used lanes (0,2), 1 = used lanes (1,3), -1 = none
    let lastDoublePairIdx = -1;

    const makeTile = (group: ParsedNote[], index: number, lane: number): GameTile => {
        const primaryNote = group[0];
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
    };

    const laneEndSlots = [0, 0, 0, 0];

    const computeGroupEndSlot = (group: ParsedNote[]): number => {
        let end = group[0].slotStart;
        for (const n of group) {
            if (n.slotStart + n.slotSpan > end) end = n.slotStart + n.slotSpan;
        }
        return end;
    };

    const tiles: GameTile[] = [];
    let gi = 0;
    while (gi < groups.length) {
        const group = groups[gi];
        const primaryNote = group[0];
        const slotStart = primaryNote.slotStart;
        const isDouble = primaryNote.tileType === 'DOUBLE';

        // Detect a double pair: two consecutive DOUBLE groups at the same slotStart
        const nextGroup = gi + 1 < groups.length ? groups[gi + 1] : null;
        const isDoublePair = isDouble && nextGroup &&
            nextGroup[0].tileType === 'DOUBLE' &&
            Math.abs(nextGroup[0].slotStart - slotStart) < 0.0001;

        if (isDoublePair && nextGroup) {
            const endSlotA = computeGroupEndSlot(group);
            const endSlotB = computeGroupEndSlot(nextGroup);

            // Find lanes that are free at this slotStart
            const freeLanes = [0, 1, 2, 3].filter(l => slotStart >= laneEndSlots[l] - 0.0001);

            // Try preferred alternating pair first, then alternate pair, preferring pairs that avoid lastLane
            const pairIdx = lastDoublePairIdx === 0 ? 1 : 0;
            const altPairIdx = pairIdx === 0 ? 1 : 0;
            const [prefA, prefB] = pairIdx === 0 ? [0, 2] : [1, 3];
            const [altA, altB] = altPairIdx === 0 ? [0, 2] : [1, 3];

            const pairFree = (a: number, b: number) => freeLanes.includes(a) && freeLanes.includes(b);
            const pairAvoidsLast = (a: number, b: number) => a !== lastLane && b !== lastLane;

            let laneA: number, laneB: number;
            let chosenPairIdx: number;
            if (pairFree(prefA, prefB) && pairAvoidsLast(prefA, prefB)) {
                laneA = prefA; laneB = prefB; chosenPairIdx = pairIdx;
            } else if (pairFree(altA, altB) && pairAvoidsLast(altA, altB)) {
                laneA = altA; laneB = altB; chosenPairIdx = altPairIdx;
            } else if (pairFree(prefA, prefB)) {
                laneA = prefA; laneB = prefB; chosenPairIdx = pairIdx;
            } else if (pairFree(altA, altB)) {
                laneA = altA; laneB = altB; chosenPairIdx = altPairIdx;
            } else {
                // No standard pair free; pick any two free lanes avoiding lastLane if possible
                if (freeLanes.length >= 2) {
                    const freeNoLast = freeLanes.filter(l => l !== lastLane);
                    if (freeNoLast.length >= 2) {
                        laneA = freeNoLast[0]; laneB = freeNoLast[1];
                    } else {
                        laneA = freeLanes[0]; laneB = freeLanes[1];
                    }
                } else if (freeLanes.length === 1) {
                    laneA = freeLanes[0];
                    laneB = [0, 1, 2, 3]
                        .filter(l => l !== laneA)
                        .sort((a, b) => laneEndSlots[a] - laneEndSlots[b])[0];
                } else {
                    const sorted = [0, 1, 2, 3].sort((a, b) => laneEndSlots[a] - laneEndSlots[b]);
                    laneA = sorted[0]; laneB = sorted[1];
                }
                chosenPairIdx = -1;
            }
            lastDoublePairIdx = chosenPairIdx;

            tiles.push(makeTile(group, gi, laneA));
            tiles.push(makeTile(nextGroup, gi + 1, laneB));
            laneEndSlots[laneA] = Math.max(laneEndSlots[laneA], endSlotA);
            laneEndSlots[laneB] = Math.max(laneEndSlots[laneB], endSlotB);
            lastLane = laneA;
            gi += 2;
        } else {
            const endSlot = computeGroupEndSlot(group);

            // Prefer free lanes (not occupied at slotStart), avoiding lastLane and last double pair lanes
            const excludeLanes: number[] = lastDoublePairIdx >= 0
                ? (lastDoublePairIdx === 0 ? [0, 2] : [1, 3])
                : [];
            const freeLanes = [0, 1, 2, 3].filter(l => slotStart >= laneEndSlots[l] - 0.0001);

            let lane: number;
            const best = freeLanes.filter(l => l !== lastLane && !excludeLanes.includes(l));
            if (best.length > 0) {
                lane = best[Math.floor(Math.random() * best.length)];
            } else {
                const ok = freeLanes.filter(l => l !== lastLane);
                if (ok.length > 0) {
                    lane = ok[Math.floor(Math.random() * ok.length)];
                } else if (freeLanes.length > 0) {
                    lane = freeLanes[Math.floor(Math.random() * freeLanes.length)];
                } else {
                    // All occupied: pick lane with earliest end, prefer not lastLane
                    const sorted = [0, 1, 2, 3]
                        .filter(l => l !== lastLane)
                        .sort((a, b) => laneEndSlots[a] - laneEndSlots[b]);
                    lane = sorted.length > 0 ? sorted[0] : [0, 1, 2, 3].sort((a, b) => laneEndSlots[a] - laneEndSlots[b])[0];
                }
            }

            lastLane = lane;
            lastDoublePairIdx = -1;
            tiles.push(makeTile(group, gi, lane));
            laneEndSlots[lane] = Math.max(laneEndSlots[lane], endSlot);
            gi++;
        }
    }

    const totalHeight = buildLayout(tiles);
    return { tiles, totalHeight, lastLane };
}
