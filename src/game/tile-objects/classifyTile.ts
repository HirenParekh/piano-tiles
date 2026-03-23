/**
 * classifyTile.ts
 *
 * Pure tile-type classifier — no Phaser dependency.
 *
 * Extracted from TileObjectFactory so it can be unit-tested without a Phaser
 * Canvas environment. TileObjectFactory delegates to this function; tests import
 * it directly.
 *
 * Classification rules (in priority order):
 *   1. DOUBLE  — tile.note.tileType === 'DOUBLE'  (from the 5<> parser prefix)
 *   2. HOLD    — tile.slotSpan > 1                (bracket beats ÷ baseBeats > 1)
 *   3. SINGLE  — everything else
 *
 * WHY slotSpan, not notes.length:
 *   notes.length > 1 means "chord" — multiple pitches played simultaneously on
 *   one tap. A chord like (e1.g1)[L] has notes.length=2 but slotSpan=1 → SINGLE.
 *   A tall note like c2[K] with baseBeats=0.5 has slotSpan=2 → HOLD regardless
 *   of whether it is a chord.
 */

import type { GameTile } from '../../types/midi';

export type TileType = 'SINGLE' | 'HOLD' | 'DOUBLE';

/**
 * Returns the logical tile type for a given GameTile.
 *
 * @param tile - A fully-built GameTile (slotSpan must be set by buildLayout()).
 */
export function classifyTile(tile: GameTile): TileType {
  if (tile.note.tileType === 'DOUBLE') return 'DOUBLE';
  if (tile.slotSpan > 1) return 'HOLD';
  return 'SINGLE';
}
