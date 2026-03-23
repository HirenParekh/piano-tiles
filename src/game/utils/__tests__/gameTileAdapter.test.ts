/**
 * gameTileAdapter.test.ts
 *
 * Pure unit tests — no Phaser, no React, no DOM required.
 * buildAudioTileMap takes GameTile[] and returns Map<string, Tile>.
 */

import { describe, it, expect } from 'vitest';
import { buildAudioTileMap } from '../gameTileAdapter';
import type { GameTile, ParsedNote } from '../../../types/midi';
import type { HoldTile, DoubleTile, ArpeggioTile, SingleTile } from '../../../types/track';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeNote(overrides: Partial<ParsedNote> = {}): ParsedNote {
  return {
    midi: 60,
    name: 'C4',
    time: 0,
    duration: 0.5,
    velocity: 1,
    trackIndex: 0,
    trackName: 'piano',
    channel: 0,
    slotStart: 0,
    slotSpan: 1,
    ...overrides,
  };
}

function makeTile(overrides: Partial<GameTile> = {}): GameTile {
  const note = makeNote(overrides.note ?? {});
  return {
    id: 'tile-1',
    note,
    notes: [note],
    noteIndices: [1],
    lane: 0,
    tapped: false,
    height: 100,
    bottomOffset: 0,
    top: 0,
    slotStart: 0,
    slotSpan: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SINGLE tiles
// ---------------------------------------------------------------------------

describe('buildAudioTileMap — SINGLE tile', () => {
  it('maps a plain single-note tile to type SINGLE', () => {
    const tile = makeTile({ id: 'single-1' });
    const map = buildAudioTileMap([tile]);

    const result = map.get('single-1') as SingleTile;
    expect(result).toBeDefined();
    expect(result.type).toBe('SINGLE');
  });

  it('preserves id, lane, notes, noteIndices', () => {
    const note = makeNote({ midi: 64 });
    const tile = makeTile({ id: 'single-2', lane: 2, notes: [note], noteIndices: [3] });
    const map = buildAudioTileMap([tile]);

    const result = map.get('single-2')!;
    expect(result.id).toBe('single-2');
    expect(result.lane).toBe(2);
    expect(result.notes).toEqual([note]);
    expect(result.noteIndices).toEqual([3]);
  });

  it('sets rowSpan to 1', () => {
    const tile = makeTile({ id: 'single-3' });
    const map = buildAudioTileMap([tile]);
    expect((map.get('single-3') as SingleTile).rowSpan).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// HOLD tiles
// ---------------------------------------------------------------------------

describe('buildAudioTileMap — HOLD tile', () => {
  it('maps a multi-slot tile to type HOLD', () => {
    const note1 = makeNote({ slotStart: 0, slotSpan: 2 });
    const note2 = makeNote({ slotStart: 1, slotSpan: 1 });
    const tile = makeTile({
      id: 'hold-1',
      notes: [note1, note2],
      slotSpan: 2,
    });
    const map = buildAudioTileMap([tile]);

    const result = map.get('hold-1') as HoldTile;
    expect(result.type).toBe('HOLD');
  });

  it('sets isActive and isCompleted to false', () => {
    const note1 = makeNote({ slotSpan: 2 });
    const note2 = makeNote({ slotStart: 1 });
    const tile = makeTile({ id: 'hold-2', notes: [note1, note2], slotSpan: 2 });
    const map = buildAudioTileMap([tile]);

    const result = map.get('hold-2') as HoldTile;
    expect(result.isActive).toBe(false);
    expect(result.isCompleted).toBe(false);
  });

  it('sets rowSpan from slotSpan (rounded)', () => {
    const tile = makeTile({ id: 'hold-3', notes: [makeNote(), makeNote()], slotSpan: 3.1 });
    const map = buildAudioTileMap([tile]);
    // Math.round(3.1) = 3
    expect((map.get('hold-3') as HoldTile).rowSpan).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// ARPEGGIO tiles
// ---------------------------------------------------------------------------

describe('buildAudioTileMap — ARPEGGIO tile', () => {
  it('maps a tile with arpeggioDelayS to type ARPEGGIO', () => {
    const note1 = makeNote({ arpeggioDelayS: 0 });
    const note2 = makeNote({ arpeggioDelayS: 0.1 });
    const tile = makeTile({ id: 'arp-1', notes: [note1, note2], slotSpan: 1 });
    const map = buildAudioTileMap([tile]);

    const result = map.get('arp-1') as ArpeggioTile;
    expect(result.type).toBe('ARPEGGIO');
  });

  it('detects ARPEGGIO even when only one note has arpeggioDelayS', () => {
    const note1 = makeNote({});
    const note2 = makeNote({ arpeggioDelayS: 0.05 });
    const tile = makeTile({ id: 'arp-2', notes: [note1, note2], slotSpan: 1 });
    const map = buildAudioTileMap([tile]);

    expect((map.get('arp-2') as ArpeggioTile).type).toBe('ARPEGGIO');
  });
});

// ---------------------------------------------------------------------------
// DOUBLE tiles
// ---------------------------------------------------------------------------

describe('buildAudioTileMap — DOUBLE tiles', () => {
  it('maps tiles with tileType=DOUBLE to type DOUBLE', () => {
    const noteA = makeNote({ tileType: 'DOUBLE' });
    const tileA = makeTile({ id: 'dbl-a', note: noteA, notes: [noteA], lane: 0, slotStart: 4 });
    const noteB = makeNote({ tileType: 'DOUBLE' });
    const tileB = makeTile({ id: 'dbl-b', note: noteB, notes: [noteB], lane: 2, slotStart: 4 });

    const map = buildAudioTileMap([tileA, tileB]);

    expect((map.get('dbl-a') as DoubleTile).type).toBe('DOUBLE');
    expect((map.get('dbl-b') as DoubleTile).type).toBe('DOUBLE');
  });

  it('gives both paired tiles the SAME pairNotes array reference', () => {
    // useTileAudio uses a WeakMap keyed on pairNotes identity —
    // if the references differ, the second tap never fires.
    const noteA = makeNote({ tileType: 'DOUBLE' });
    const noteB = makeNote({ tileType: 'DOUBLE', midi: 64 });
    const tileA = makeTile({ id: 'pair-a', note: noteA, notes: [noteA], lane: 0, slotStart: 8 });
    const tileB = makeTile({ id: 'pair-b', note: noteB, notes: [noteB], lane: 2, slotStart: 8 });

    const map = buildAudioTileMap([tileA, tileB]);

    const pairA = (map.get('pair-a') as DoubleTile).pairNotes;
    const pairB = (map.get('pair-b') as DoubleTile).pairNotes;

    // MUST be the same object, not just equal content.
    expect(pairA).toBe(pairB);
  });

  it('orders pairNotes left-to-right (lane 0 before lane 2)', () => {
    const noteLeft = makeNote({ tileType: 'DOUBLE', midi: 60 });
    const noteRight = makeNote({ tileType: 'DOUBLE', midi: 67 });
    const tileLeft  = makeTile({ id: 'lr-a', note: noteLeft,  notes: [noteLeft],  lane: 0, slotStart: 12 });
    const tileRight = makeTile({ id: 'lr-b', note: noteRight, notes: [noteRight], lane: 2, slotStart: 12 });

    // Pass right before left to verify sorting is by lane, not input order.
    const map = buildAudioTileMap([tileRight, tileLeft]);
    const pairNotes = (map.get('lr-a') as DoubleTile).pairNotes;

    expect(pairNotes[0].midi).toBe(60); // lane 0 first
    expect(pairNotes[1].midi).toBe(67); // lane 2 second
  });

  it('does not group DOUBLE tiles from different slotStarts', () => {
    const noteA = makeNote({ tileType: 'DOUBLE' });
    const noteB = makeNote({ tileType: 'DOUBLE', midi: 64 });
    const tileA = makeTile({ id: 'diff-a', note: noteA, notes: [noteA], lane: 0, slotStart: 0 });
    const tileB = makeTile({ id: 'diff-b', note: noteB, notes: [noteB], lane: 0, slotStart: 4 });

    const map = buildAudioTileMap([tileA, tileB]);

    const pairA = (map.get('diff-a') as DoubleTile).pairNotes;
    const pairB = (map.get('diff-b') as DoubleTile).pairNotes;

    // Different slotStarts → different pairNotes arrays.
    expect(pairA).not.toBe(pairB);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('buildAudioTileMap — edge cases', () => {
  it('returns an empty map for an empty tiles array', () => {
    expect(buildAudioTileMap([])).toEqual(new Map());
  });

  it('handles a single tile correctly', () => {
    const tile = makeTile({ id: 'solo' });
    const map = buildAudioTileMap([tile]);
    expect(map.size).toBe(1);
    expect(map.get('solo')).toBeDefined();
  });

  it('DOUBLE check takes priority over HOLD (slotSpan > 1 + tileType DOUBLE)', () => {
    // Contrived case: a DOUBLE note with slotSpan > 1.
    // DOUBLE should win over HOLD in the priority order.
    const note = makeNote({ tileType: 'DOUBLE' });
    const tile = makeTile({ id: 'dbl-hold', note, notes: [note], slotSpan: 3 });
    const map = buildAudioTileMap([tile]);
    expect((map.get('dbl-hold') as DoubleTile).type).toBe('DOUBLE');
  });
});
