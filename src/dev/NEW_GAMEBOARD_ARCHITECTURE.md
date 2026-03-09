# New GameBoard Architecture

This document explains the modern refactored architecture of the `GameBoard.tsx` and how it translates raw MIDI events into a scalable, high-performance interface.

## 1. The Core Philosophy: From Pixels to Grids
Historically, the Piano Tiles game board positioned every individual tile using **absolute pixel math** (e.g., `bottom: 4324px`). While that approach worked for basic notes, it broke down when handling complex sequences, rapid arpeggios, and multi-beat **Hold Cards** because absolute nodes do not natively respect the physical boundaries of each other in the DOM.

**The New Architecture** shifts entirely to a **Slot/Row-Based System**:
Instead of managing thousands of free-floating absolute divs, the new GameBoard uses native **CSS Grids** and **Flexbox** to chunk the song into isolated, beat-aligned containers called `Cards`. 

## 2. Core Concepts
* **`MIN_HEIGHT`**: A constant (100px) representing exactly 1 beat (or slot) of music. All tile heights and row logic are quantized as multiples of `MIN_HEIGHT`.
* **Track Data (`trackBuilder.ts`)**: An intermediate engine between the Parser and the React Board. It analyzes the raw MIDI tile array and chunks them vertically into contiguous `Card` objects.
* **Cards**: Contiguous blocks of layout. Types include:
   * `INFO`: The initial block that displays the song title and author.
   * `START`: The initial blue start button segment.
   * `TILE`: A grid container that spans N beats and holds multiple actual note-cells.
   * `EMPTY`: Blank buffer space between musical gaps.
   * `FINISH`: The final end marker of the track.

## 3. How `TileCard` CSS Grids Work
Whenever a `TILE` Card is rendered, instead of floating absolute positioning, it dynamically becomes a CSS Grid whose rows match the exact musical span required for that block of notes:

```tsx
<div style={{
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)', // 4 Lanes
  gridTemplateRows: `repeat(${card.span}, 1fr)`, // N Beats Span
}}>
```

Inside this Grid, individual tiles (like `GameTileCard` or `HoldTileCard`) map themselves natively using grid coordinates:
```tsx
gridColumn: tile.lane + 1,
gridRow: `${card.span - tile.rowStart - tile.rowSpan + 1} / span ${tile.rowSpan}`
```
*(Mathematical Note: The row start is inverted because the Grid maps top-to-bottom, but our Track array builds bottom-to-top using `flex-direction: column-reverse`.)*

### The Hold Tile Advantage
By using this CSS Grid architecture, **Hold Tiles** solve themselves completely natively. If a hold note lasts for 2 beats, we tell CSS `grid-row: X / span 2` and the browser guarantees it structurally spans exactly the required height inside the grid box without a single pixel of overlapping calculation hacking.

## 4. The Data Pipeline
If you are developing or touching the song pipeline, the data flows like this:

1. **`pianoTilesParser.ts`**: (Raw JSON/MIDI -> `GameTile[]`)
   Reads MIDI logic and generates absolute timings. Translates `time` into pure height offsets (e.g. `bottomOffset: 1200`).
   *(Crucial: We inject `START_OFFSET_ROWS = 0` here to begin actual tiles precisely at `bottomOffset: 0` without gap-padding).*

2. **`trackBuilder.ts`**: (`GameTile[]` -> `GameTrackData`)
   Iterates through tiles sequentially. 
   - Manually injects `INFO` and `START` cards precisely before actual track data.
   - Computes overlap chunks to form `TILE` cards with computed `.span` values.

3. **`GameBoard.tsx`**: (`GameTrackData` -> DOM)
   Renders the `Cards` sequentially inside a `<div flex-direction: "column-reverse">`. 
   Handles smooth auto-scrolling via `useAutoScroll`. No complex layout math is performed in the React layer — it purely translates Card Spans into CSS layout constraints.

## 5. Animation & Scrolling Handoff
To support both developer debugging and high-performance gameplay, the GameBoard features a **Seamless Scroll Handoff**:
* **Before Starting**: The `.game-board__viewport` has `overflow-y: scroll`, and the `.game-board__canvas` has no transformations. This allows developers to native-scroll up and down the track to inspect `Card` mapping and Grid layouts smoothly.
* **During Gameplay**: When the user taps the `START` tile, `GameBoard` toggles `.game-board__viewport` to `overflow: hidden`. Simultaneously, `useAutoScroll` intercepts the current scroll position, locks `scrollTop` to `0`, and applies a `translate3d(0, targetPx, 0)` translation on the canvas. 
* By offloading movement to `translate3d`, the browser bypasses DOM layout repaints, pushing the animation directly to the GPU for buttery-smooth 60fps tracking.
