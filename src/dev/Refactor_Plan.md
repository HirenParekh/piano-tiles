# Refactor: Float-Based Pipeline → Slot-Based Pipeline
 
## Context
 
The app was originally built for raw MIDI files (un-quantized, floating-point timing). Piano Tiles 2 JSON is perfectly quantized grid data, but our pipeline currently:
 
```
PT2 JSON (slot-based) → seconds (float) → Math.round → pixels → Math.round → row integers
```
 
This creates epsilon hacks (`- 0.001`), `Math.round` recovery steps, and a `mergeConsecutiveNotes()` function that re-discovers structure already known at parse time. Now that raw MIDI support is archived, we can eliminate this round-trip.
 
**Goal:** Track positions in slot units throughout the pipeline. Derive seconds only for audio. Derive pixels only for rendering.
 
---
 
## Files to Modify
 
| File | Change |
|------|--------|
| `src/types/midi.ts` | Add `slotStart`, `slotSpan` to `ParsedNote` + `GameTile`; extend `ScrollSegment` |
| `src/utils/pianoTilesParser.ts` | Rewrite `parseScore()` to track integer slots; slot-based bass overlap |
| `src/utils/midiParser.ts` | Rewrite merge/layout/overlap to use slots; remove dead MIDI code; rename to `tileBuilder.ts` |
| `src/utils/trackBuilder.ts` | Read `slotStart`/`slotSpan` directly; add `noteIndices`; drop `gameTile: any` |
| `src/types/track.ts` | Add `noteIndices` to `BaseTile`; remove `gameTile: any` |
| `src/components/GameBoard.tsx` | Pass track `Tile` to card components instead of `tile.gameTile` |
| `src/components/GameTileCard.tsx` | Accept track `Tile` type; read `tile.notes[0]` instead of `tile.note` |
| `src/components/HoldTileCard.tsx` | Same as GameTileCard |
| `src/hooks/useGameBoard.ts` | Change type from `GameTile` to track `Tile` |
| `src/App.tsx` | Update `handleTileTap` to accept track `Tile`; use `tile.type === 'HOLD'` instead of `tile.height > MIN_HEIGHT` |
 
---
 
## Step 1: Extend Types (`src/types/midi.ts`)
 
Add slot fields to `ParsedNote`:
```typescript
interface ParsedNote {
  // ... existing fields ...
  slotStart: number;       // Absolute slot index (integer for 99% of cases)
  slotSpan: number;        // Duration in slots (bracketBeats / baseBeats)
  arpeggioDelayS?: number; // Sub-slot audio offset for @%!~$^& operators (audio-only)
}
```
 
Add slot fields to `GameTile`:
```typescript
interface GameTile {
  // ... existing fields ...
  slotStart: number;  // Tile start slot (absolute across whole song)
  slotSpan: number;   // Tile height in slots (>= 1)
}
```
 
Extend `ScrollSegment` with slot data:
```typescript
interface ScrollSegment {
  startSlot: number;
  endSlot: number;
  slotDurationS: number; // For variable-BPM sections
  // Keep existing derived pixel/time fields
  startPixel: number; endPixel: number;
  startTime: number; endTime: number;
}
```
 
---
 
## Step 2: Rewrite Parser (`src/utils/pianoTilesParser.ts`)
 
### `parseScore()` changes:
- Replace `let currentTime = 0` → `let currentSlot = 0`
- Track `currentSlot` as a number (integer in practice; fractional only for exotic bracket combos like `[KM]` at certain baseBeats values)
- For rest tokens: `restSlots = restBeats / baseBeats`; `currentSlot += restSlots`
- For `ST`: `currentSlot += 3 / baseBeats`
- For note tokens: `bracketSlots = bracketBeats / baseBeats`; set `slotStart = currentSlot`, `slotSpan = bracketSlots`; advance `currentSlot += bracketSlots`
- Arpeggio sub-notes: share same `slotStart`/`slotSpan`; compute `arpeggioDelayS` float for audio offset
- After loop: derive seconds via `note.time = note.slotStart * slotDurationS + (note.arpeggioDelayS ?? 0)` and `note.duration = note.slotSpan * slotDurationS - (note.arpeggioDelayS ?? 0)`
- Return `{ notes, totalSlots: currentSlot }` instead of `{ notes, totalTimeS }`
 
### `buildResultFromPianoTilesSong()` changes:
- Track `currentSlotOffset` (number) instead of float `currentTimeOffset` + pixel `currentBottomOffset`
- Keep a separate `currentTimeOffset` float only for ScrollSegment time derivation (needed for variable-BPM sections)
- Section height: `sectionTotalSlots * MIN_HEIGHT` (exact, no `Math.round`)
- Bass overlap detection: `bassNote.slotStart >= m.slotStart && bassNote.slotStart < m.slotStart + m.slotSpan` — no epsilon
- Bass tile attachment: same slot-based comparison
- Shift tile offsets: `tile.slotStart += currentSlotOffset`
- Derive pixel positions: `tile.bottomOffset = Math.round(tile.slotStart) * MIN_HEIGHT`, `tile.height = Math.max(1, Math.round(tile.slotSpan)) * MIN_HEIGHT`
- ScrollSegments: populate both slot and derived pixel/time fields
- Tile IDs: `tile-${index}-${tile.note.midi}-${tile.slotStart}` (no `.toFixed(3)`)
 
---
 
## Step 3: Rewrite Tile Builder (`src/utils/midiParser.ts` → rename to `src/utils/tileBuilder.ts`)
 
### `mergeConsecutiveNotes()` — use integer slot comparison:
- Same slot = chord: `next.slotStart === startSlot` (no `< 0.001` epsilon)
- Hold absorption: `next.slotStart < maxEndSlot` where `maxEndSlot = max(n.slotStart + n.slotSpan)`
 
### `buildLayout()` — direct slot→pixel:
- `tile.height = Math.max(1, Math.round(tile.slotSpan)) * MIN_HEIGHT`
- `tile.bottomOffset = Math.round(tile.slotStart) * MIN_HEIGHT`
- No `beatDurationS` parameter needed
 
### Overlap detection — integer slot ranges:
- `laneEndSlots[lane]` array instead of `laneEndTimes`
- `if (startSlot < laneEndSlots[tile.lane])` — no `GAP = 0.05` float
- `laneEndSlots[tile.lane] = Math.max(laneEndSlots[tile.lane], endSlot)`
 
### `buildTilesFromNotes()` new signature:
```typescript
function buildTilesFromNotes(
  notes: ParsedNote[],
  initialLastLane?: number,
): { tiles: GameTile[]; totalHeight: number; lastLane: number }
```
Remove `bpm` and `beatDurationSOverride` params — no longer needed.
 
### Dead code removal:
- Delete `parseMidiFile()`, `buildTilesFromTracks()`, `readFileAsArrayBuffer()`, `extractTrackMeta()`
- Delete `import { Midi } from '@tonejs/midi'`
- Delete `GM_INSTRUMENTS` map
- Keep: `MIN_HEIGHT`, `LAYOUT_PAD_TOP`, `mergeConsecutiveNotes`, `buildLayout`, `buildTilesFromNotes`, `getInstrumentCategory`, `isKeyboardByName`
 
### Rename file:
`midiParser.ts` → `tileBuilder.ts` (update all imports)
 
---
 
## Step 4: Update Track Builder (`src/utils/trackBuilder.ts`)
 
Replace pixel-division with direct slot reads:
```typescript
// Before:
const rowStart = Math.round(t.bottomOffset / MIN_HEIGHT);
const rowSpan = Math.max(1, Math.round(t.height / MIN_HEIGHT));
 
// After:
const rowStart = Math.round(t.slotStart);
const rowSpan = Math.max(1, Math.round(t.slotSpan));
```
 
Add `noteIndices` to the created Tile objects. Remove `gameTile: t` reference.
 
Remove `import { MIN_HEIGHT } from './midiParser'` if no longer needed here.
 
---
 
## Step 5: Update Track Types (`src/types/track.ts`)
 
```typescript
interface BaseTile {
  id: string;
  type: TileType;
  lane: number;
  rowStart: number;
  rowSpan: number;
  notes: ParsedNote[];
  tapped: boolean;
  noteIndices: number[];  // ADD
  // gameTile: any;        // REMOVE
}
```
 
---
 
## Step 6: Update Components
 
### `GameBoard.tsx`:
- Pass `tile` (track Tile) directly instead of `tile.gameTile`
- Remove `scaleRatio` prop from card components (grid already handles sizing)
- Update `onPlayNote` type: `(tile: Tile) => void`
 
### `GameTileCard.tsx` + `HoldTileCard.tsx`:
- Change Props type from `GameTile` to track `Tile`
- Replace `tile.note` → `tile.notes[0]`
- Replace `tile.noteIndices[0]` → `tile.noteIndices[0]` (now on Tile directly)
- Remove `tile.top * scaleRatio` / `tile.height * scaleRatio` from default style (grid overrides them anyway)
- Keep tooltip reads: `tile.notes[0].time`, `tile.notes[0].duration` (still populated as derived fields)
 
### `useGameBoard.ts`:
- Change `GameTile` type to track `Tile`
 
### `App.tsx`:
- Change `handleTileTap(tile: GameTile)` → `handleTileTap(tile: Tile)`
- Replace `tile.height > MIN_HEIGHT` → `tile.type === 'HOLD'`
- Replace `tile.note` → `tile.notes[0]`
- Remove `import { MIN_HEIGHT } from './utils/midiParser'` (no longer needed in App.tsx)
- Update `import` from `midiParser` → `tileBuilder`
 
---
 
## Step 7: Update All Imports
 
Search and replace across codebase:
- `from './midiParser'` → `from './tileBuilder'`
- `from '../utils/midiParser'` → `from '../utils/tileBuilder'`
 
---
 
## Verification
 
1. Load Little Star (simple, single-section) — tiles at correct positions, audio plays correctly
2. Load a multi-section song — verify section transitions, scroll speed changes
3. Check hold tiles span correct number of rows
4. Check bass accompaniment dots appear on correct melody tiles (not floating)
5. Run `tsc --noEmit` — no type errors
6. Check the dev server console for any runtime errors
7. Verify the build compiles: `npm run build`
