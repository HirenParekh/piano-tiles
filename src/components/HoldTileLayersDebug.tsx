/**
 * HoldTileLayersDebug — renders a hold tile in slow-motion for visual debugging.
 *
 * Tile data: first hold tile from Jingle Bells
 *   Melody  e3[K]  — primary note, 2 slots, 0.5 s
 *   Bass    g[L]   — secondary beat at slot +1 (0.25 s in)
 *   Bass    e1[L]  — secondary beat at slot +1, chord with g
 */

import { useState } from 'react';
import { HoldTileCard } from '../archive/css-board/HoldTileCard';
import type { HoldTile } from '../types/track';
import type { ParsedNote } from '../types/midi';

// ── Slow-motion speed ──────────────────────────────────────────────────────
const SPEED = 0.1; // 10× slower than real-time
const FROM_BOTTOM = 1;

const CELL_W = 90;
const CELL_H = 250;

// ── Mock ParsedNote helper ─────────────────────────────────────────────────
const note = (overrides: Partial<ParsedNote>): ParsedNote => ({
  midi: 60, name: 'C4', time: 0, duration: 0.5,
  velocity: 0.8, trackIndex: 0, trackName: 'melody',
  channel: 0, slotStart: 0, slotSpan: 1,
  ...overrides,
});

// ── Jingle Bells first hold tile ──────────────────────────────────────────
const primaryNote = note({ midi: 88, name: 'E6', slotStart: 0, slotSpan: 2, duration: 0.5 });
const beatNotes: ParsedNote[] = [
  note({ midi: 55, name: 'G3',  time: 0.25, slotStart: 1, slotSpan: 1, duration: 0.25, trackIndex: 1 }),
  note({ midi: 64, name: 'E4',  time: 0.25, slotStart: 1, slotSpan: 1, duration: 0.25, trackIndex: 1 }),
];

const mockTile: HoldTile = {
  id: 'debug-hold',
  type: 'HOLD',
  lane: 0,
  rowStart: 0,
  rowSpan: 2,
  notes: [primaryNote, ...beatNotes],
  tapped: false,
  noteIndices: [0, 1, 2],
  isActive: false,
  isCompleted: false,
};

const SINGLE_TILE_H = CELL_H / mockTile.rowSpan;

// ── Main component ─────────────────────────────────────────────────────────
export function HoldTileLayersDebug() {
  // cardKey increments on Play/Reset to force remount.
  // autoPlay=true → card starts hold on mount; false → sits in initial state.
  const [cardKey, setCardKey] = useState(0);
  const [shouldPlay, setShouldPlay] = useState(true);

  const handlePlay = () => {
    setShouldPlay(true);
    setCardKey(k => k + 1);
  };

  const handleReset = () => {
    setShouldPlay(false);
    setCardKey(k => k + 1);
  };

  return (
    <div style={{ padding: 32, background: '#080810', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ color: '#888', fontSize: 12, fontFamily: 'monospace' }}>
          Jingle Bells · e3[K] + g[L]/e1[L] · {SPEED}× speed · fromBottom={FROM_BOTTOM}
        </span>
        <button
          onClick={handlePlay}
          style={{ padding: '6px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#c8ff00', color: '#000', fontWeight: 700, fontSize: 13 }}
        >
          ▶ Play
        </button>
        <button
          onClick={handleReset}
          style={{ padding: '6px 20px', borderRadius: 6, border: '1px solid #444', cursor: 'pointer', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: 13 }}
        >
          ↺ Reset
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ fontSize: 10, color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Composite
        </span>
        <div style={{ width: CELL_W, height: CELL_H, position: 'relative', borderRadius: 6, overflow: 'visible', border: '1px solid #2a2a3a' }}>
          <HoldTileCard
            key={cardKey}
            tile={mockTile}
            speed={SPEED}
            singleTileH={SINGLE_TILE_H}
            style={{ position: 'absolute', inset: 0 }}
            autoPlay={shouldPlay ? FROM_BOTTOM : undefined}
            onTap={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
