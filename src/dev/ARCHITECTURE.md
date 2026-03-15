# Piano Tiles — Application Architecture

> This document describes the full structure of the app: data flow, rendering pipeline,
> component hierarchy, and the skin system. Keep it updated as the architecture evolves.

---

## High-Level Data Flow

```
PT2 JSON file
     │
     ▼
pianoTilesParser.ts          — parseScore() → slot-based ParsedNote[]
     │                           • slotStart / slotSpan are authoritative integers
     │                           • time / duration derived for audio scheduling
     ▼
tileBuilder.ts               — buildTilesFromNotes() → GameTile[]
     │                           • assigns lanes (0-3), detects overlaps
     │                           • Double tile pairs get non-adjacent lanes (0&2 or 1&3)
     │                           • min slot size = 1 (sub-slot tiles render as 1 row)
     ▼
trackBuilder.ts              — buildTrackFromTiles() → GameTrackData { cards, totalRows }
     │                           • groups tiles into Card[] for CSS grid rendering
     │                           • adds INFO, START, FINISH, EMPTY cards automatically
     ▼
useGameBoardEngine (hook)    — scales pixels, wires auto-scroll, tracks tapped state
     │                           • scaleRatio = (viewportH / 4) / MIN_HEIGHT
     │                           • scaledTotalHeight = totalRows × MIN_HEIGHT × scaleRatio
     ▼
GameBoard (orchestrator)     — picks a visual skin, passes engine to it
     │
     ├── GameBoardClassicSkin   — production UI (bokeh, gradient, no labels)
     └── GameBoardDebugSkin     — dev UI (beat lines, note labels, grey bg)
              │
              └── TileLayer     — shared card renderer (used by both skins)
                       │
                       ├── GameTileCard    — SINGLE tiles
                       ├── HoldTileCard    — HOLD tiles (laser line, ring, beat dots)
                       └── DoubleTileCard  — DOUBLE tiles (5<> notation)
```

---

## Key Concepts

### Slot System
- **1 slot** = the minimum unit of time and space. `MIN_HEIGHT = 100px` unscaled.
- `slotStart` and `slotSpan` are always integers after the parser (min span = 1).
- Pixels are only derived at render time: `px = slots × MIN_HEIGHT × scaleRatio`.
- Seconds are only derived for audio: `seconds = slots × slotDurationS`.

### Scale Ratio
The board is designed so **exactly 4 slots** are visible in the viewport at once:
```
scaleRatio = (viewportH / 4) / MIN_HEIGHT
```
Every pixel value in the renderer is multiplied by `scaleRatio`.

### Card System
`trackBuilder` converts the flat `GameTile[]` into a `Card[]`. This keeps the renderer
simple — it iterates cards linearly and doesn't need to think about overlapping tiles.

| Card type | Purpose |
|-----------|---------|
| `INFO`    | Song title banner, sits at the very bottom of the canvas |
| `START`   | Tap-to-start tile, one row above INFO |
| `EMPTY`   | Blank spacer for musical rests / gaps |
| `TILE`    | One or more playable tiles sharing grid rows (CSS grid handles placement) |
| `FINISH`  | Checker-stripe finish line at the top of the canvas |

### Tile Types

| Type     | Description | Lane rule |
|----------|-------------|-----------|
| `SINGLE` | Standard one-row tap tile | Random lane, no repeat |
| `HOLD`   | Multi-row tile held by the player | Random lane, span > 1 |
| `DOUBLE` | Two simultaneous tiles (from `5<>` notation) | Always paired on lanes (0,2) or (1,3), alternating |

---

## Skin System

`GameBoard` is a pure orchestrator. It:
1. Runs `useGameBoardEngine` once to get all game state.
2. Picks a skin component based on the `skin` prop.
3. Passes `{ engine, onHoldRelease, onHoldBeat, onExit }` to the skin.

**The engine lives in `GameBoard`, not inside the skin.** This means switching skins
(e.g. toggling debug mode while a song is running) does not restart the engine or
reset the scroll position.

### Adding a new skin

1. Create `src/components/GameBoardMySkin.tsx` accepting `GameBoardSkinProps`
2. Add `'myskin'` to the `GameBoardSkin` union in `GameBoard.tsx`
3. Add a branch: `if (skin === 'myskin') return <GameBoardMySkin {...skinProps} />;`

### Skin differences

| Feature | Classic | Debug |
|---------|---------|-------|
| Background | Animated gradient (blue/purple/cyan) | Solid #333 |
| Bokeh circles | Yes | No |
| Lane dividers | Thin white semi-transparent | Standard grey |
| Beat lines | No | Yes (beat index + wall-clock time) |
| Note labels on tiles | Hidden via CSS | Visible |
| Scrollbar | Hidden | Visible (thin) |

---

## Directory Structure

```
src/
├── components/
│   ├── GameBoard.tsx              ← Skin orchestrator (entry point)
│   ├── GameBoardClassicSkin.tsx   ← Production visual skin
│   ├── GameBoardDebugSkin.tsx     ← Developer visual skin
│   ├── TileLayer.tsx              ← Shared card-to-tile renderer
│   ├── GameTileCard.tsx           ← SINGLE tile component
│   ├── HoldTileCard.tsx           ← HOLD tile (SVG ring, beat dots, fill)
│   ├── DoubleTileCard.tsx         ← DOUBLE tile component
│   ├── TileRendererWidget.tsx     ← Dev sandbox (JSON input → tile preview)
│   ├── SongSelection.tsx          ← Song library screen
│   └── CanvasGameBoard.tsx        ← Experimental canvas-based renderer
│
├── hooks/
│   ├── useGameBoardEngine.ts   ← All game logic (scale, scroll, timing, tapped state)
│   ├── useGameBoard.ts         ← Tap state management + scrollRef
│   ├── useAutoScroll.ts        ← rAF loop that drives scrollTop (isPlayingRef pattern)
│   ├── useSynth.ts             ← Tone.js sampler (Salamander Grand Piano)
│   ├── useTileAudio.ts         ← Bridges tile taps to audio playback
│   └── usePlayback.ts          ← Full song auto-playback (preview mode)
│
├── utils/
│   ├── pianoTilesParser.ts  ← PT2 JSON → ParsedNote[] (slot-based)
│   ├── tileBuilder.ts       ← ParsedNote[] → GameTile[] (lane assignment, layout)
│   └── trackBuilder.ts      ← GameTile[] → Card[] (CSS grid groups)
│
├── types/
│   ├── midi.ts    ← ParsedNote, GameTile, MidiParseResult, ScrollSegment
│   └── track.ts   ← Tile (SINGLE|HOLD|DOUBLE), Card, GameTrackData
│
├── styles/
│   ├── main.scss                  ← Imports all partials
│   ├── _game-board.scss           ← Tile + debug board styles, hold tile SCSS
│   ├── _game-board-classic.scss   ← Classic skin: gradient, bokeh, lane dividers
│   └── _variables.scss            ← $accent, $accent2, $accent3, $border, …
│
└── dev/
    ├── ARCHITECTURE.md    ← (this file)
    ├── GAME_ASCII_FORMAT.md
    ├── PIANO_TILES_2_FORMAT.md
    └── re/README.md       ← libcocos2dcpp.so reverse engineering notes
```

---

## Audio Pipeline

Audio is handled entirely outside the game board:

```
App.tsx
  useSynth           — loads Salamander sampler, exposes playNote/attackNote/releaseNote
  useTileAudio       — maps tile types to correct audio calls
    • SINGLE/DOUBLE → playNote(midi, duration)
    • HOLD tap      → attackNote(midi)
    • HOLD beat     → playNote(midi, 0.1s) for each merged sub-note
    • HOLD release  → releaseNote(midi)
  usePlayback        — full song auto-playback for the song selection preview
```

`onPlayNote` is passed into `GameBoard` and forwarded to `useGameBoardEngine`.
The engine calls it when `tapTile` fires. Audio is never scheduled inside the board.

---

## Critical Constants

| Constant | Value | Where defined | Meaning |
|----------|-------|---------------|---------|
| `MIN_HEIGHT` | 100px | `tileBuilder.ts` | 1 slot = 100px at scale 1:1 |
| `LAYOUT_PAD_TOP` | 160 | `tileBuilder.ts` | Extra top space in legacy layout |
| `effectiveBpm` | `bpm / baseBeats` | engine | True playback speed |
| `slotDurationS` | `60 / effectiveBpm` | engine | One slot in real seconds |

---

## SCSS Rules

- **Never** use `darken()` / `lighten()` — use hardcoded hex or `color.adjust()`
- **Never** use `nth()` with a variable — use `@each $i, $c in $map`
- Accent colours: `$accent: #c8ff00` (neon green), `$accent2: #ff4d6d` (red), `$accent3: #00cfff` (cyan)
- Classic skin lives in `_game-board-classic.scss`, uses `.classic-board` BEM root
- Legacy board styles live in `_game-board.scss`, uses `.game-board` BEM root
