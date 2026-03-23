/**
 * gameTileAdapter.ts
 *
 * Converts GameTile (Phaser's data model) into the Tile type that useTileAudio expects.
 *
 * RESPONSIBILITY:
 *   Bridge the gap between the Phaser rendering pipeline (which works with GameTile
 *   from midi.ts) and the existing audio system (which works with Tile from track.ts).
 *
 * DOES NOT:
 *   - Play audio.
 *   - Know about Phaser or React.
 *   - Mutate the input tiles.
 *
 * WHY a separate adapter (not inline in PhaserGameBoard):
 *   The conversion logic — especially DOUBLE tile pair grouping — is non-trivial
 *   enough to warrant its own unit tests. Keeping it pure (no side effects,
 *   no framework dependencies) makes it trivially testable.
 *
 * TILE TYPE DETECTION RULES (in priority order):
 *   1. DOUBLE  — tile.note.tileType === 'DOUBLE'
 *   2. HOLD    — Math.round(tile.slotSpan) > 1  (tile spans multiple slots)
 *   3. ARPEGGIO — any note has arpeggioDelayS set (sub-slot staggered audio)
 *   4. SINGLE  — everything else
 *
 * DOUBLE TILE PAIRING:
 *   useTileAudio tracks sequential taps using a WeakMap keyed on the SAME
 *   ParsedNote[] reference shared by both tiles of a double pair.
 *   We group DOUBLE tiles by slotStart (they always share the same slot),
 *   build ONE shared pairNotes array, and assign it to both converted tiles.
 */

import type { GameTile } from '../../types/midi';
import type {
  Tile,
  SingleTile,
  HoldTile,
  DoubleTile,
  ArpeggioTile,
} from '../../types/track';
import type { ParsedNote } from '../../types/midi';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Converts an array of GameTiles into a Map keyed by tile.id.
 *
 * Build this map once when a song loads (it's pure — same input → same output).
 * Then look up tiles by id when the EventBus fires TILE_TAPPED.
 *
 * @param gameTiles - All tiles for the current song from MidiParseResult.tiles.
 * @returns Map<tileId, Tile> — ready for useTileAudio.handleTileTap().
 */
export function buildAudioTileMap(gameTiles: GameTile[]): Map<string, Tile> {
  // ── Step 1: Group DOUBLE tiles by slotStart to build shared pairNotes ──
  //
  // useTileAudio tracks sequential double taps with:
  //   doublePairTapRef.current.get(pairNotes) → tapIndex
  // For this WeakMap lookup to work correctly, BOTH tiles in a pair must
  // reference the EXACT SAME pairNotes array (same object identity, not
  // just equal content). We create one array per slot and assign it to both.
  const doublePairNotes = new Map<number, ParsedNote[]>();

  for (const tile of gameTiles) {
    if (tile.note.tileType !== 'DOUBLE') continue;

    if (!doublePairNotes.has(tile.slotStart)) {
      // Collect notes from all DOUBLE tiles at this slotStart.
      // Sort by lane so the play order is always left-to-right (lane 0 first).
      const pairTiles = gameTiles
        .filter(t => t.note.tileType === 'DOUBLE' && t.slotStart === tile.slotStart)
        .sort((a, b) => a.lane - b.lane);

      doublePairNotes.set(tile.slotStart, pairTiles.flatMap(t => t.notes));
    }
  }

  // ── Step 2: Convert each GameTile to the appropriate Tile subtype ──
  const map = new Map<string, Tile>();

  for (const gameTile of gameTiles) {
    map.set(gameTile.id, convertTile(gameTile, doublePairNotes));
  }

  return map;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Converts a single GameTile to the appropriate Tile variant.
 *
 * @param gameTile        - Source tile from the parser.
 * @param doublePairNotes - Pre-built shared pairNotes map for DOUBLE tiles.
 */
function convertTile(
  gameTile: GameTile,
  doublePairNotes: Map<number, ParsedNote[]>,
): Tile {
  // Common fields shared by all tile variants.
  const base = {
    id: gameTile.id,
    lane: gameTile.lane,
    // rowStart / rowSpan map to slot positions — kept for type compatibility.
    rowStart: gameTile.slotStart,
    rowSpan: Math.max(1, Math.round(gameTile.slotSpan)),
    notes: gameTile.notes,
    tapped: gameTile.tapped,
    noteIndices: gameTile.noteIndices,
  };

  // Priority 1: DOUBLE — two simultaneous tiles played sequentially.
  if (gameTile.note.tileType === 'DOUBLE') {
    const pairNotes = doublePairNotes.get(gameTile.slotStart) ?? gameTile.notes;
    return {
      ...base,
      type: 'DOUBLE',
      rowSpan: 1,
      pairNotes,
    } satisfies DoubleTile;
  }

  // Priority 2: HOLD — tile spans more than one slot; player must hold finger down.
  if (Math.round(gameTile.slotSpan) > 1) {
    return {
      ...base,
      type: 'HOLD',
      isActive: false,
      isCompleted: false,
    } satisfies HoldTile;
  }

  // Priority 3: ARPEGGIO — single-slot tile with staggered sub-slot note timing.
  if (gameTile.notes.some(n => typeof n.arpeggioDelayS === 'number')) {
    return {
      ...base,
      type: 'ARPEGGIO',
      rowSpan: 1,
    } satisfies ArpeggioTile;
  }

  // Default: SINGLE — one tap, one note (or merged chord).
  return {
    ...base,
    type: 'SINGLE',
    rowSpan: 1,
  } satisfies SingleTile;
}
