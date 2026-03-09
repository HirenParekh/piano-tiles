# Code Review Journal

## How to hit the ground running with this Journal
- **Purpose**: A compact log of our codebase review and architectural discoveries to maintain context during a long project.
- **What to log**: Brief, high-level summaries of Q&A sessions.
- **What NOT to log**: Overly verbose explanations, exact code snippets (unless critical), or routine UI adjustments. Focus on architecture, data pipelines, and engine mechanics.
- **Format**: Keep it to bullet points and brief Q&A blocks (`Q:` and `A:`).

---
## Session 1: SongSelection & Initialization Pipeline

**Q: I was reviewing the SongSelection component. It looks straightforward. Tell me what happens once we select the song?**

**A:** When you click "Play" on a song in the `SongSelection` component, a clean data pipeline is triggered. Here is the exact step-by-step breakdown:

1. **The `onPlaySong` Trigger**: Clicking the "Play" button triggers `onPlaySong(song.id)`, which is passed down from `App.tsx` and linked to `handlePlaySong`.
2. **Fetching the Data**: `App.tsx` makes an HTTP `fetch` request to the `/songs/` directory in your `public` folder to load the raw JSON file for that specific song.
3. **Parsing the JSON (`pianoTilesParser.ts`)**: The app calls the core parser engine, `buildResultFromPianoTilesSong(ptJson, 0, id)`. This translates raw Piano Tiles 2 string instructions into an object containing:
   - `notes`: Audio events in absolute time.
   - `tiles`: Physical layout objects tracking spatial information (lane, height, vertical offset).
   - `scrollSegments`: Timeline mappings for the auto-scroller.
4. **Updating Application State**: The parser outputs a complete `MidiParseResult` object. `App.tsx` stops any currently playing music and updates the React state via `setPickedResult(result)`.
5. **Rendering the Game Board**: `App.tsx` hides the empty state and renders the `GameBoard.tsx` component, passing it the new result data.
6. **Drawing the CSS Grid**: Inside `GameBoard.tsx`, `trackBuilder.ts` chunks the tiles into `Card` components, draws them onto the DOM via CSS Grid, and prepends the "START" tile at the bottom.

*(End of Session 1)*

## Session 2: Data Parsing & `ParsedNote` Interface
**Q: Need more JSDoc on `buildResultFromPianoTilesSong`. Are we still using all `ParsedNote` properties, or is it outdated MIDI baggage?**

**A:**
- Added detailed JSDoc to `buildResultFromPianoTilesSong` explaining the milestone extraction and grid assignment pipeline.
- `ParsedNote` is still fully utilized! It acts as an adapter, forcing Piano Tiles JSON data to mimic old MIDI node logic. `time`, `duration`, and `midi` drive the audio/layout constraints. `trackIndex` separates Melody/Bass. `velocity` is statically forced to 0.7 to satisfy Tone.js.

*(End of Session 2)*

## Session 3: Refactoring Scope
**Q: You mentioned `buildResultFromPianoTilesSong` acts as a massive "adapter," forcing Piano Tiles 2 data to conform to our existing MIDI node logic. Does this mean there is scope for refactoring and optimization?**

**A:** Yes, absolutely. Because the app was originally built to read raw `.mid` files (which are complex, chaotic, and un-quantized), the core types and layout engine (like `midiParser.ts` and `GameTile`) are built to handle *time-proportional floating point math* (seconds, fractions of beats).
Piano Tiles JSON, however, is essentially a rigid "Grid Template." When we parse `c1[L]`, we already mathematically know exactly how many "Slots" high that tile is, and exactly what row it resides on. 

Currently, our pipeline does this:
1. Parse JSON -> Convert to floating point "Seconds" and "MIDI numbers" (The Adapter phase).
2. Feed to `midiParser.js` -> Use complex math algorithms to convert those "Seconds" *back* into quantized Grid Rows and collision-avoidance lanes.

**Refactoring Scope:**
If we entirely drop the "Raw MIDI File" feature (which we just archived), we could completely remove `ParsedNote` and the math algorithms in `midiParser.js`. We could write a parser that reads the JSON score string and directly outputs raw `x/y` Grid Coordinates and Slot heights. This would radically simplify the architecture, remove almost all floating-point timestamp calculations, and make rendering significantly faster and closer to the original game's engine.

*(End of Session 3)*
