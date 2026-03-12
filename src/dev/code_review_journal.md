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

## Session 4: Float-to-Slot Pipeline Migration
**Q: Following up on the Refactoring Scope, did we successfully transition away from float-based time calculations?**

**A:** Yes! We completely migrated from a time-proportional float pipeline to an integer "Slot-based" pipeline. 
Since Piano Tiles JSON gives us strict grid rules (e.g., this tile is exactly 0.5 beats long), we now track `slotStart` and `slotSpan` throughout the entire data flow instead of converting through float `seconds` to figure out spatial positioning.

**Key Architectural Changes:**
1. **Parser Simplification (`pianoTilesParser.ts`)**: The core parser loop now natively tracks `currentSlot`. Overlaps for bass accompaniments are now mathematically certain: `bassNote.slotStart >= m.slotStart`.
2. **Layout Engine Rewrite (`tileBuilder.ts`)**: We completely deleted `midiParser.ts` (and its GM Instrument map) and built a lightweight `tileBuilder.ts`. Collision avoidance and hold-tile merging no longer require floating-point epsilon (`- 0.001`) checks.
3. **Strict Domain Types (`track.ts`)**: Physical visual tracks are strictly derived via `rowSpan = Math.round(t.slotSpan)`. 
4. **Unified React Components**: `App.tsx` and `GameBoard.tsx` completely dropped `GameTile` in favor of reading the raw properties directly off the universal `Tile` objects. Time in seconds is now derived at the very end strictly for the audio synth.

*(End of Session 4)*

## Session 5: UX Iterations - Song List Ordering
**Q: How did we prioritize our song order to guarantee a smooth, frictionless onboarding experience for new players?**

**A:** Our initial iteration required standardizing our song selection list to present the most recognizable, foundational tracks at the top of the collection. The `songCatalog.json` has been officially restructured to pin six crucial tracks to indices 0 through 5:
1. **Little Star** (Classic tutorial track)
2. **Jingle Bells** (Universally recognizable)
3. **Canon**
4. **Beyer No.8**
5. **Jasmine**
6. **Dolls and Bear Dancing**

These tracks serve as our gateway lineup. The remaining catalog follows sequentially afterward.

*(End of Session 5)*

## Session 6: Testing Engine Core Logic
**Q: The user wants to start implementing E2E tests for the core logic (JSON to Tile creation rules). How do we securely validate this architecture?**

**A:** While browser-driven E2E tests are great for UI, the core domain here is heavy deterministic mathematical parsing. Therefore, we chose to implement **Vitest** for robust natively integrated Unit Tests. Testing at the unit level is vastly faster and less brittle when dealing with numeric offsets.

We created two distinct testing suites to lock down the new Slot-based engine:
1. **`pianoTilesParser.test.ts` (Tokenizer)**: Validates that literal string definitions (e.g. `[L]`, `[K]`, `T` rests, `(c1@e1@g1)`) correctly translate to structural `slotSpan` duration metadata, track rest-padding correctly, and handle complex ornament timing delays without shifting geometric Layout definitions.
2. **`tileBuilder.test.ts` (Layout/Collision)**: Mocks raw arrays of `notes` and validates the math algorithms that:
   - Merge simultaneous matching notes into exactly 1 `GameTile`.
   - Absorb shorter trailing cascade notes gracefully into an existing Hold Tile's structural bounds.
   - Dynamically shift lane positions cleanly without floats when overlapping `slotStart` bounds are detected in exactly the same lane.

*(End of Session 6)*

## Session 7: UX Iterations - Game State Transitions & HUD
**Q: The initial app showed a split-screen view. How did we improve the immersion and flow from Song Selection into active Gameplay?**

**A:** We restructured the root `App.tsx` router state to fully mount either the "Song Selection" screen OR the "Game Board" screen. 
- When `pickedResult` is null, the player is presented with the stylized Song Catalog (which now natively includes the foundational songs at the top).
- Upon selecting a track, the UI switches to an immersive full-screen `GameBoard` and drops the standard sidebars and headers.
- **HUD (Heads-Up Display)**: We added a translucent back button to the top-left (which fades into a low-opacity state gracefully when the `started` boolean flips true to avoid visual distraction during gameplay) and a bold center-aligned Score element replicating the red outlined font style of Piano Tiles 2.
- Exiting gameplay safely hits a new `onExit` callback that halts all `useSynth()` playback events gracefully and fully unmounts the GameBoard React tree (thereby aggressively wiping its internal hook states back to 0 so the board is always perfectly fresh upon reentry).

- **Song Selection Fix**: We removed the hardcoded `375px` by `667px` limits from `_song-selection.scss` allowing the track list to organically map to the `1024px` app container we set up.

*(End of Session 7)*

## Session 8: UX Iterations - Viewport Aspect Ratio Clamping
**Q: How did we ensure the App viewport remains within a "mobile game" aspect ratio rather than awkwardly stretching across ultra-wide desktop monitors?**

**A:** To strictly maintain a portrait orientation bounded by a realistic threshold (e.g., maximum 3:4 typical iPad/Tablet aspect ratio), we applied a CSS `min()` constraint to the global root wrapper:
```tsx
style={{ maxWidth: 'min(1024px, 75vh)' }}
```
By binding the `maxWidth` relative to the height of the viewport via `75vh` (3/4 of `100vh`), any wide desktop window will strictly clamp the bounds inwards to maintain a column-based "mobile app" feel. Conversely, true 16:9 vertical phones will naturally utilize their organic `100% width` layout without hitting the `75vh` ceiling.

- **Global Highlight Immunity**: Since this is a tappable game running in the DOM, holding down on tiles inherently triggers aggressive device text highlighting/clipboard popup callouts. We've universally patched this with `-webkit-user-select: none;` and `-webkit-touch-callout: none;` securely bound at the root `body` node (`_reset.scss`). No visual element can be text-selected by the player anymore.
- **Tile Styling Fidelity**: We stripped away the CSS `border-radius` applied to the `.game-board` and individual `.game-tile`s to give the notes their completely flat, flush edge-to-edge authenticity. We also removed the subtle `transform: scaleY(0.95);` squeeze animation that previously played when tapping a tile, ensuring it feels instantly responsive without visual lag.
- **Authentic Ripple Animation**: When a tile is tapped, we injected a precise CSS keyframe sequence (`tapRipple`) utilizing a pseudo `::after` element centered identically over the root `.game-tile`. This visually constructs a seamless scaling white translucent block that expands rapidly out from the direct center (`scale(0)` to `scale(1)`) mimicking the genuine Piano Tiles tap sequence. The parent tile simultaneously drops in overall opacity smoothly to execute the full gray flush effect matching your provided gameplay frame captures.
- **Ultra-Fast Bezier Animation Curve**: To nail the breakneck, snappy cadence of the original game, the `tapRipple` animation was aggressively tuned. Its duration was lowered from `0.25s` to just `0.1s`, and it relies on a razor-sharp custom `cubic-bezier(0.1, 1.0, 0.1, 1.0)` curve so the ripple blasts out instantly and snaps perfectly to the boundary edges without a slow ballooning ease.
- **Mobile-Native Tile Fidelity**: We finally stripped out the legacy desktop CSS `:hover` states on all game tiles (Start, Normal, and Hold variants), ensuring the game purely interprets discrete pointer-down tap events without glitching false-positive hover highlights on touchscreens. Furthermore, we dropped the baseline tap-state opacity from `0.6` down to `0.3`, drastically increasing the contrast of hit tiles so players can instantly visually parse successful inputs out from the dark scrolling viewport.
- **Song Info Card Unification**: To visually connect the track metadata panel inside the `GameBoard` to the `SongSelection` screen, we dropped the baseline white card design at the bottom of the track (`card.type === 'INFO'`). It now utilizes the exact same vibrant gradient (`#74a1ee` to `#1aaeea`) paired with inverted white text and drop shadows, creating a beautifully cohesive visual language from the menu to gameplay.
- **Global Typography Standardization**: We stripped away the outdated generic `Bebas Neue` and `Space Mono` typography scales from our SASS configuration (`_variables.scss`), strictly routing both `$font-disp` and `$font-mono` globally to `'Inter', sans-serif`. This guarantees consistency and immediate readability across both application states.

- **Screen Transitions & Layout Stability**: We re-engineered the DOM layering system to eliminate the visual UI 'flash' caused by the `GameBoard` layout recalculating its dimensions immediately upon mount. By completely preventing the `.game-board__canvas` from mounting into the DOM until the `ResizeObserver` successfully captures a `viewportH > 0`, we completely exterminated any residual scale-ratio "jump" artifacts caused by the initial hardcoded 600px fallback. Because the internal grid layout math is now fully stabilized before React ever attempts to paint the board, we were safely able to restore the high-quality, parallel sliding transitions! Both the entry and exit are fully symmetric: the menu smoothly slides out left as the runway slides in exactly simultaneously, and when you tap the back arrow to exit, the `isExiting` state simply reverses the CSS `transform` vectors while delaying un-mount by 500ms so you actively see the clean UI sweep returning you to the menu. Additionally, we swapped `useEffect` to a synchronous `useLayoutEffect` block inside `useAutoScroll.ts` to guarantee `scrollTop` coordinates apply synchronously eliminating any trace of a 1-frame scroll jump.
- **HUD Contrast Tuning**: The core `GameBoard` back-arrow UI contrast has been explicitly increased. It now sits with an active-state `opacity` of `0.6` instead of `0.3`, and utilizes a `drop-shadow` to artificially distance itself visibly against the black runway background!

*(End of Session 8)*

## Session 9: Hardware Virtualization Feasibility
**Q: Looking ahead to future large-level optimizations, we mentioned Virtualization to unmount hidden `Tile` elements. Can virtualization handle `HoldTile` structures that span across multiple screen viewports?**

**A:** Yes, the `@tanstack/react-virtual` library handles tall/mixed-height components with zero issues. Because our custom parser strictly maps `slotSpan * MIN_HEIGHT * scaleRatio` directly onto `height` up front, we have a perfectly deterministic map of where every component physically begins and ends from pixel 0.
When configuring `useVirtualizer`, you supply an `estimateSize` callback logic array, and since our `MidiParseResult` computes `cardH` during mounting, the virtualizer instantly understands that a massively long Hold Tile extending 4 viewports high intersecting the local viewport overlap threshold should *not* be unmounted until its *bottom edge* falls entirely outside upper limit rendering range.

*(End of Session 9)*
