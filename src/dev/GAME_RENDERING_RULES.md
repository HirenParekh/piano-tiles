# Game Rendering & Engine Rules

This document outlines which mechanics in our current Piano Tiles web app are derived directly from the original **Piano Tiles 2 (PT2) JSON** song files, and which are custom mechanics inherited from our original raw MIDI parser engine.

## 1. Original Piano Tiles 2 Rules (JSON Derived)

The visual and musical timelines of the original game are governed strictly by the values inside the loaded JSON arrays.

*   **Note Scaling & Pitch Mapping**: The string identifier mapping (`c1` -> MIDI 60, `A-3` -> MIDI 21, `g` -> MIDI 43) is perfectly reverse-engineered from the PT2 `json2midi` C++ reference.
*   **Tile Heights & Durations**: The exact visual height of tiles is driven by the PT2 bracket notation. `[L]` = 0.5 beats, `[K]` = 1 beat, `[H]` = 8 beats. Taking this beat fraction and dividing it by `baseBeats` gives us precisely how many "slots" tall the block should be rendered (`scaleRatio * MIN_HEIGHT`).
*   **Timeline Increments**: The song sequences advance strictly by 1 slot for every comma `,` or semicolon `;` encountered in the score string sequence list.
*   **Speed Curves / Progression**: The `musics` array increments gameplay speed by loading increasing BPM phases to endlessly loop and accelerate the game.

## 2. Custom Web Engine Rules (MIDI Tracker Derived)

*These mechanics are custom to our React codebase. They were originally authored so we could play raw standard MIDI files (which naturally contain dense, chaotic 10-finger chords), converting them into an easier "1 finger tap per beat" mobile web experience. These override the explicit layout intentions of authentic PT2 gameplay.*

1.  **Melody Canvas (Bass Accompaniment)**: The original PT2 game uses multiple array tracks `scores[0]` and `scores[1]`. Only the Melody track (`scores[0]`) actually generates visible, tappable tiles on the board! The subsequent Bass arrays act simply as musical accompaniment that plays dynamically as the user progresses through the physical Melody chunks. Currently, our engine renders `scores[0]` as the explicitly playable grid array!
2.  **Strict Row Merging (Single Mega-Tiles)**: Original PT2 operates single-lane logic per chunk—but because our engine was originally built for complex generic MIDI files, we forcefully `mergeConsecutiveNotes()`. This clusters all synchronous notes falling at `t=0` within the Melody track into single Tap or Hold blocks! 
4.  **Lane Randomization vs Prescribed Lanes**: The original game explicitly tracks sequences to avoid overlaps. Our web app assigns random lane indices visually (`Math.random()`), and then runs an Overlap Collision Detector to bump colliding notes out of the given lane. Because we group tiles by timestamp, concurrent notes never land on the same visual slot, making multi-touch collisions extremely rare in our current engine.
5.  **Hold Tile Component Drawing**: Our engine previously drew dots over hold tiles for *every* merged sub-note inside an aggregated tile chunk (e.g., drawing a dot when a short Bass note fired during a long Melody hold). Original PT2 simply treats "Hold Tiles" as long, clean rectangular strips. (Note: True PT2 hold tiles *do* show points ticks midway through holds, but only if they are genuinely multi-part sustained score annotations).
