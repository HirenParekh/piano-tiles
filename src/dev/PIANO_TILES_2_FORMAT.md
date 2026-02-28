# Piano Tiles 2 — Complete Song Format Reference

Compiled from: official modding wiki, ARM64 binary static analysis (libcocos2dcpp.so),
and empirical testing against 848 real song JSON files.

---

## 1. JSON File Structure

Each song is a `.json` file in `/assets/res/song/`.

```json
{
  "baseBpm": 90,
  "musics": [
    {
      "id": 1,
      "bpm": 90,
      "baseBeats": 0.5,
      "scores": ["<score_string_0>", "<score_string_1>"],
      "instruments": ["piano", "piano"],
      "alternatives": ["", ""],
      "audition": { "start": [0, 0], "end": [1, 43] }
    },
    {
      "id": 2,
      "bpm": 95,
      "baseBeats": 0.5,
      "scores": ["<score_string_0>", "<score_string_1>"]
    }
  ]
}
```

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `baseBpm` | number | Legacy field; modern songs define BPM per-music entry. Can be ignored. |
| `musics` | array | One entry per difficulty level (Easy → Expert). |

### Per-music fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Difficulty identifier (1-indexed). Also encodes star rating. |
| `bpm` | yes | Beats per minute. Determines playback speed. |
| `baseBeats` | yes | Duration of one "slot" in beats. Typical values: 0.25, 0.5, 1. |
| `scores` | yes | Array of score strings. Index 0 = melody, index 1 = bass/accompaniment. |
| `instruments` | no | Array of instrument names matching scores[]. Default: `"piano"`. |
| `alternatives` | no | Fallback instruments for offline mode. |
| `audition` | no | Song preview range: `{"start":[id,noteIndex],"end":[id,noteIndex]}`. |

---

## 2. Timing Model

### Slot duration
```
slotDurationS = baseBeats × (60 / bpm)     ← seconds per comma-separated slot
```

### Scroll speed (original game)
```
TPS (tiles per second) = bpm / (baseBeats × 60)
PX/s = TPS × MIN_HEIGHT                    ← MIN_HEIGHT = 100px per slot
```

### Key insight
**Every comma-separated token advances the timeline by exactly 1 slot** (`slotDurationS` seconds),
regardless of the tile's bracket letters. The bracket letters control visual height and audio
duration, not timeline advancement.

---

## 3. Score String Grammar

A score string is a comma-separated (and semicolon-separated) sequence of tokens.

```
score    := token (',' token)* (';' token)*
token    := rest | stop | group | note | chord
```

Semicolons (`;`) are **visual measure markers only** — treat them identically to commas.

---

## 4. Note Names

### Format
```
noteName := ['#'] letter [signedOctave]
letter   := 'a'..'g' | 'A'..'G'
signedOctave := [-]digit
```

### Octave mapping (PianoTiles → standard MIDI / Tone.js)
| PianoTiles notation | Tone.js name | MIDI # | Description |
|---------------------|-------------|--------|-------------|
| `A-3` | A0 | 21 | Lowest piano key |
| `B-3` | B0 | 23 | |
| `C-2` | C1 | 24 | |
| … | … | … | |
| `B-1` | B2 | 47 | Last uppercase-negative |
| `c` | C3 | 48 | First lowercase (no suffix = octave 0) |
| `c1` | C4 | 60 | Middle C |
| `c2` | C5 | 72 | |
| `c3` | C6 | 84 | |
| `c4` | C7 | 96 | |
| `c5` | C8 | 108 | Highest note (highest piano key) |

**MIDI formula:** `midi = (octave + 4) × 12 + noteOffset + (isSharp ? 1 : 0)`
where octave is the numeric suffix (0 if absent, negative for uppercase letters like `G-1`).

**Confirmed from json2midi source (GetNote lookup table):** c1=60, c2=72, c=48, B-1=47, C-1=36, C-2=24, A-3=21, c5=108.

**Note offsets:** c=0, d=2, e=4, f=5, g=7, a=9, b=11

**Special values:** `mute`, `empty` — used in arpeggios to insert silence.

**No `#e` or `#b`** (E# = F, B# = C — not used in this format).

---

## 5. Tile Length Brackets

Every note or chord token ends with a length bracket `[letters]`.
Letters represent absolute beat counts and combine **additively**.

| Letter | Beats | Typical use |
|--------|-------|-------------|
| H | 8 | Very long hold |
| I | 4 | Long hold |
| J | 2 | Short hold / 2-beat tile |
| **K** | **1** | **Standard tap (1 beat)** |
| **L** | **0.5** | **Half-beat tap (most common)** |
| M | 0.25 | Quarter-beat tap |
| N | 0.125 | Eighth-beat tap |
| O | 0.0625 | |
| P | 0.03125 | |

**Combined brackets:** `[KM]` = 1 + 0.25 = 1.25 beats. `[HI]` = 8 + 4 = 12 beats.

**Visual height:** `height_px = (sum_beats / baseBeats) × MIN_HEIGHT`
**Audio duration:** `duration_s = sum_beats × (60 / bpm)`

**Timeline advancement** is always 1 slot (NOT the beat count). Hold tiles
visually overlap subsequent tiles — the player holds their finger through them.

### Practical convention
Songs set `baseBeats` so that the most common bracket = 1 slot:
- `baseBeats=0.5` → `[L]` is 1 slot (standard tap)
- `baseBeats=1` → `[K]` is 1 slot (standard tap)
- `baseBeats=0.25` → `[M]` is 1 slot (fast songs)

---

## 6. Rest / Space Tokens

A standalone letter (no brackets, no note name) is a rest. Same letter set as tiles
but offset by 8 positions in the alphabet.

| Letter | Beats | Equivalent tile letter |
|--------|-------|----------------------|
| Q | 8 | H |
| R | 4 | I |
| **S** | **2** | J — **but S = STOP in game binary, use carefully** |
| **T** | **1** | K |
| **U** | **0.5** | L |
| **V** | **0.25** | M |
| W | 0.125 | N |
| X | 0.0625 | O |
| Y | 0.03125 | P |

**Timeline advancement:** `rest_beats × (60 / bpm)` seconds
(= `rest_beats / baseBeats` slots).

**Convention:** songs use the rest letter that equals exactly 1 slot for their baseBeats:
- `baseBeats=0.5` songs use `U` as the standard rest
- `baseBeats=1` songs use `T` as the standard rest

**IMPORTANT — `S` is STOP, not a rest.** Confirmed in the game binary: `S` and `ST`
both terminate score parsing. Never use `S` as a rest token.

---

## 7. Stop Tokens

| Token | Meaning |
|-------|---------|
| `S` | Stop parsing — end of score |
| `ST` | Also stop (variant) |

Everything after `S` or `ST` in a score string is ignored.

---

## 8. Group Tokens

```
group := N '<' items '>'
items := token (',' token)*
```

`N` is a positive integer. The group spans `N` slots total on the timeline.
All items inside are divided evenly: each item lasts `N / count` slots.

**Single-item group** = hold tile: `9<f3[J]>` = note f3 held for 9 slots.
**Multi-item group** = arpeggio/run: `5<a2[L],g2[L]>` = a2 for 2.5 slots, g2 for 2.5 slots.

Numbers 2–10 also encode **special tile types** (see Section 10). The same `N<...>`
syntax serves both timing groups and special tiles.

---

## 9. Chord Tokens

```
chord := '(' noteName ('.' noteName)+ ')' '[' letters ']'
```

Multiple notes played simultaneously as a single tile.
Note order does not matter musically.

**Examples:**
- `(e1.g1.c2)[L]` — E3 + G3 + C4, half-beat duration
- `(#C-2.#C-1.#c)[K]` — three-note chord, 1-beat duration
- `(f3.a3.a2.A-1.A-2)[LM]` — five-note chord, 0.75-beat duration

The bracket letters define the combined duration of the entire chord (same rules as single notes).

---

## 10. Special Tile Types

Special tiles use the `N<items>` syntax where N is 2–10 and has specific meaning:

| N | Tile type | Notes |
|---|-----------|-------|
| 2 | Single tile | Combines items into one unit; total length = 1 |
| 3 | Combo tile | Each sub-tile = +1 score point regardless of length |
| 5 | Double tile | All notes play simultaneously (multi-touch); items should be simultaneous |
| 6 | Long (slide) tile | Connects items into one extended visual strip |
| 7 | Unbroken slide | Max 28 sub-tiles; total length should be 2 |
| 8 | Broken slide | Max 28 sub-tiles; for lengths 1–28 (not 2) |
| 9 | Accompaniment | Background tile; best for challenge modes only |
| 10 | Burst tile | All items merge into one large tile on tap; max 20 items |

**Any other number crashes the game.**

---

## 11. Arpeggios

Arpeggios use operator characters mixed into note groups.
Notes play sequentially (not simultaneously).

| Operator | Delay formula | Description |
|----------|--------------|-------------|
| `@` | d = l/(10×(n-1)) | Standard arpeggio |
| `%` | d = 3l/(10×n) | Slower arpeggio |
| `!` | d = 3l/(20×n) | Fast arpeggio |
| `~` | same duration | Glissando (up) |
| `$` | same duration | Glissando (down) |
| `^` | — | Ornament (upper) |
| `&` | — | Ornament (lower) |

Where `n` = number of operators, `l` = tile length, `d` = delay between notes.

**Rule:** cannot combine two different operator types in the same tile — game will crash.

---

## 12. Special Effects

Appended in curly braces after the tile bracket:

```
note[L]{3}
```

| Code | Effect |
|------|--------|
| `{1}` | Mild lightness on tap |
| `{2}` | Additional visual effects on screen |
| `{3}` | Bright lightness on tap |
| `{4}` | Switch to first background |
| `{5}` | Switch to second background (with integrated effects) |

Effects only work with the second background layer.

---

## 13. Multiple Score Strings

A song's `scores` array contains one string per "layer":
- **Index 0** — Melody (right hand / main theme)
- **Index 1** — Bass / accompaniment (left hand)
- **Index 2+** — Additional layers

In the original game all layers produce tappable tiles in their respective lanes.
Some implementations treat score 1 as background audio only (not tappable).

All score strings must have **identical total slot count** — they run in parallel.
A score string ending early does not affect the others.

---

## 14. Instruments

```json
"instruments": ["piano", "piano"],
"alternatives": ["free_loop_bass", "bass"]
```

- `instruments` — sound bank per score string (must match scores[] length)
- `alternatives` — offline fallback per score string
- Default if omitted: `"piano"`
- Files are `.mp3` located in `/assets/res/music/`

---

## 15. Audition (Preview)

```json
"audition": { "start": [0, 0], "end": [1, 43] }
```

- Both `start` and `end` are `[musicIndex, noteIndex]` (0-indexed)
- Defines the tile range used for the in-game song preview before purchase

---

## 16. Complete Grammar Summary

```
score    := (token ',')* token?
token    := rest | stop | group | note | chord | arpeggio

rest     := restLetter              ; Q R T U V W X Y  (S = STOP, not rest)
stop     := 'S' | 'ST'
group    := integer '<' token (',' token)* '>'
note     := noteName '[' lengthLetters ']' ('{' digit '}')?
chord    := '(' noteName ('.' noteName)+ ')' '[' lengthLetters ']' ('{' digit '}')?
arpeggio := '(' (noteName | operator)+ ')' '[' lengthLetters ']'

noteName      := ['#'] ('a'..'g' | 'A'..'G') ['-'? digit]
lengthLetters := ('H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P')+
restLetter    := 'Q'|'R'|'T'|'U'|'V'|'W'|'X'|'Y'
operator      := '@'|'%'|'!'|'~'|'$'|'^'|'&'
```

---

## 17. Real Example — Little Star (Easy)

```json
{ "bpm": 90, "baseBeats": 0.5 }
```
`slotDurationS = 0.5 × (60/90) = 0.333s`

**Score 0 (Melody):**
```
c2[L] , U , (e1.g1.c2)[L] , c1[L] , g2[L] , U , (g1.b1.g2)[L] , c2[L]
 t=0    rest   t=0.667        t=1.0   t=1.333  rest    t=2.0         t=2.333
```

**Score 1 (Bass):**
```
c[L] , g[L] , T , e[L] , c1[L] , T
 t=0    t=0.333  rest  t=1.0   t=1.333  rest
```

Notes produced (first 10 tiles):
| t=0.000s | c2 (C4) melody, c (C2) bass |
| t=0.333s | g (G2) bass |
| t=0.667s | chord e1+g1+c2 (E3+G3+C4) melody |
| t=1.000s | c1 (C3) melody, e (E2) bass |
| t=1.333s | g2 (G4) melody, c1 (C3) bass |

---

## 18. Known Binary Internals (libcocos2dcpp.so ARM64)

From static analysis of the original Android game binary:

- `CProcessScore::parseScore` — main score parser at `0x15a987c`
- `parseNoteName` at `0x15a723c` — parses `[#]letter[octave]`
- Outer jump table at `0x17059a0` (chars N–Z):
  - `N` → group handler
  - `S` → stop handler (checks next char for 't')
  - `U` → rest/silence handler (advance 1 slot)
  - All others → fall through to `parseNoteName`
- `D` prefix → `DoubleRowLayer` (two simultaneous tiles in adjacent lanes)
- Tile class hierarchy: `LongRowLayer`, `DoubleRowLayer`, `AccompnyRowLayer`,
  `BombRowLayer`, `BigRowLayer`, `BurstRowLayer`, `FlippingTiles`, etc.
- Score fields stored in `CProcessScore` object: BPM at offset `0x40`,
  maxScore at `0x44`, minScore at `0x48`, scoreString at `0x58`.

---

## 19. Implementation Notes (Web Clone)

Built with: Vite + React 18 + TypeScript + Tone.js (Salamander Grand Piano samples).

- `slotDurationS = baseBeats × (60/bpm)` — every comma = this many seconds
- `effectiveBpm = bpm / baseBeats` — used for scroll speed (`PX_PER_SEC = MIN_HEIGHT × effectiveBpm / 60`)
- `MIN_HEIGHT = 100px` — 1 slot = 100px of board height
- Score 0 notes → lanes 2–3 (right side, melody), Score 1 → lanes 0–1 (left side, bass)
- `tileScoreIndices` parameter controls which score strings produce tappable tiles
  (remaining scores can be treated as background audio)
- Chord notes `(n1.n2)[K]` → single tile object with `tile.notes[]` array; on tap, all notes play
- `N<single_note>` groups → hold tile spanning N × slotDurationS seconds
- Known parser gaps: `D`-prefix double tiles, arpeggios, special effects `{n}`

---

*Last updated: 2026-02-27*
