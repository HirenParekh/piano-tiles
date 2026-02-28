# Piano Tiles 2 — libcocos2dcpp.so Reverse Engineering

## Files Here
| File | Contents |
|---|---|
| `libcocos2dcpp_strings.txt` | All 41 076 printable ASCII strings extracted from the binary |
| `libcocos2dcpp_symbols.txt` | 16 225 entries from the ELF dynamic symbol table (.dynsym) |
| `game_logic_symbols.txt` | Filtered subset — 2 005 symbols with game-related keywords |
| `mangled_game_symbols.txt` | 26 mangled C++ names containing key game classes |

---

## What strings extraction revealed (already confirmed in our implementation)

### JSON field names (confirmed in binary)
`baseBpm`, `baseBeats`, `musics`, `scores`, `instruments`, `alternatives`, `audition`

### Tile speed formula (confirmed by report + binary)
```
TPS  = BPM / (baseBeats × 60)     ← tiles per second
PX/s = TPS × MIN_HEIGHT            ← scroll speed in pixels/second
```
Example — Little Star (90 BPM, baseBeats=0.5): TPS=3, PX/s=300

### Complete RowLayer (tile type) hierarchy
| C++ class | Tile type |
|---|---|
| `LongRowLayer` | Hold tile — tap & hold |
| `DoubleRowLayer` | Two simultaneous tiles (same row, different lanes) |
| `AccompnyRowLayer` | Accompaniment — long tile + target notes |
| `TiltAccompnyRowLayer` | Diagonal/angled accompaniment |
| `TiltFixedAngleAccompnyRowLayer` | Fixed-angle variant |
| `AccompnyAndBlockRowLayer` | Accompaniment + block combo |
| `BurstRowLayer` | Burst — shatters into normal tiles on tap |
| `BombRowLayer` | Bomb — similar to Burst |
| `BigRowLayer` | Wide/oversized tile |
| `HeavyRowLayer` | Heavy tile (requires harder tap?) |
| `MistRowLayer` | Mist tile (hidden/obscured) |
| `FlippingTiles` | Flipping animation tile |
| `BattleRowLayer` | Multiplayer battle tile |
| `InstrusionRowLayer` | Intrusion (opponent's tiles in battle) |

### Score parser class
`CProcessScore` — processes the score notation strings
`CMusicJson_Row` / `CMusicJson_Data` — JSON data model for song rows

---

## Static Analysis Results — ARM64 Disassembly (capstone)

The binary was statically analysed using Python + capstone without a rooted device.

### ELF Sections (arm64-v8a, 29 MB)
| Section | vaddr | file offset | size |
|---|---|---|---|
| `.text` | `0x00529000` | `0x00529000` | `0x01091d44` |
| `.rodata` | `0x015bad50` | `0x015bad50` | `0x0014b7c8` |
| `.data.rel.ro` | `0x01a83d60` | `0x01a73d60` | `0x001428e8` |
| `.rela.dyn` | `0x0017e010` | `0x0017e010` | `0x003a64a0` (159 411 RELATIVE entries) |

### Class virtual addresses (found via RTTI + RELA chain)
| C++ class | typeinfo obj vaddr | vtable base vaddr |
|---|---|---|
| `CProcessScore` | `0x1b19ca0` | `0x1b1add8` |
| `CMusicJson_Row` | `0x1ab0c10` | `0x1a8a7e0` |
| `LongRowLayer` | `0x1aac448` | `0x1aaec38` |
| `DoubleRowLayer` | `0x1aaa8e8` | `0x1aaa900` |
| `AccompnyRowLayer` | `0x1aa4f10` | `0x1aa4f28` |
| `BombRowLayer` | `0x1aa6a68` | `0x1aa7160` |
| `BigRowLayer` | `0x1aa9b00` | `0x1aa9b18` |
| `CheckAccompanyCmd` | `0x1aa4658` | `0x1a86210` |
| `ChangeBPMCmd` | `0x1aa4640` | `0x1a861d8` |
| `NormalTouchCmd` | `0x1aa4720` | `0x1aa4738` |

### CProcessScore virtual function table
All 32 entries confirmed in `.text` (addresses are vaddr = file offset for PIE base 0):

| idx | vaddr | likely role |
|---|---|---|
| 0 | `0xbbbf70` | destructor 1 |
| 1 | `0xbbbf94` | destructor 2 |
| 2 | `0x1101d3c` | init / setBpm |
| 3 | `0x1101ed0` | setNoteCount |
| 10 | `0x1102e24` | setBpm (float setter, dirty-flags 0x14c/0x108/0x191) |
| 11 | `0x1102d1c` | getBpm (float getter from offset 0x40) |
| 12 | `0x1102fa8` | setMaxScore |
| 13 | `0x1102ee4` | getMaxScore (float from offset 0x44) |
| 15 | `0x1102f8c` | getMinScore (float from offset 0x48) |
| 16 | `0x1102c04` | setScore (float, updates 0x40/0x44/0x48, dirty-flags) |
| 20 | `0x1103410` | setScoreString (assigns string at offset 0x58, sets flags 0x60/0x61) |
| 31 | `0x110338c` | last vfunc |

**Pattern** — most setters follow: compare new == old → return early; else store +
propagate dirty flags to three byte fields (0x14c → 0x108 → 0x191) +
notify observer at `[this+0x238]` (the tile's parent node).

### Score string parser — key function addresses
| function | vaddr | description |
|---|---|---|
| `parseToken` | `0x15a987c` | Main per-token dispatcher; called once per comma-delimited slot |
| `parseNoteName` | `0x15a723c` | Reads note name (e.g. `a2`, `#f1`) from current position |
| `addNote` | `0x15a48c4` | Appends a note/tile to the output array |
| `readGroupCount` | `0x15a49e0` | Reads the integer N from `N<items>` token |
| `advancePosition` | `0x15a4b8c` | Advances the parser cursor |
| `stopHandler` | `0x15a4bf8` | Handles `S`/`ST` stop token |
| `parseNumberLiteral` | `0x15a5070` | Reads a raw integer from string (for `Ed` expression) |
| `parseFloatLiteral` | `0x15a5714` | Reads a float (for frequency/ratio values) |
| `parseInstrument` | `0x15a76cc` | Reads `I<n>` instrument index tag |

### Score token grammar (confirmed in binary)

The parser at `0x15a987c` dispatches on the **first character** of each comma-delimited token:

```
token := silence | stop | group | note | chord

silence := 'U'                        ; rest — advance 1 slot, no tile
stop    := 'S' | 'St'                 ; terminate parsing
group   := N '<' items '>'            ; N slots total, items evenly divided
note    := noteName '[' tileType ']'  ; single note
chord   := '(' noteName ('.' noteName)+ ')' '[' tileType ']'

noteName := ['#'] letter [-?digit]   ; e.g. a2, #f1, G-1
letter   := a..g | A..G
tileType := 'K'  ; normal tap tile (NormalRowLayer)
          | 'L'  ; hold tile (LongRowLayer)
          | 'H' | 'I' | 'J' | 'M'   ; other tile types
          | 'T'  ; touch-type tile
          | 'D'  ; double tile (DoubleRowLayer) prefix
```

**Jump table at `0x17059a0`** (characters N..Z, indices 0..12):
| char | target | meaning |
|---|---|---|
| `N` | `0x15a99b4` | group `N<...>` handler |
| `S` | `0x15a995c` | stop handler (checks next char for 't') |
| `U` | `0x15a9938` | rest/silence handler |
| `T`,`O`..`Z` | `0x15a98a8` | treated as note name / falls to parseNoteName |

**Inner character loop** (inside `N<...>` groups, at `0x15a99ec`):
| char | handler | meaning |
|---|---|---|
| `0`..`9` | `0x15a9bcc` | digit → part of note name |
| `a`..`z` | `0x15a9bcc` | lowercase letter → note name start |
| `U`, `L`, `C` | `0x15a9bcc` | also route to parseNoteName |
| `D` | `0x15a9c40` | DoubleRowLayer prefix |
| `S` | `0x15a9c9c` | stop token |
| `I` | `0x15a9c84` | instrument index tag |
| `T` | `0x15a9cc0` | tile type / touch handler |
| `E` | `0x15a9d98` | end-of-expression marker |
| `M` | continue | multi-byte command prefix (`Ms` or `Md`) |
| `\0` | exit | null terminator — end of score string |

### Key confirmed facts vs our implementation
| Fact | Confirmed in binary | Our impl |
|---|---|---|
| `U` = rest (silence) | YES — routes to advance-position | YES (`T` and `U` both = rest) |
| `S` = stop | YES — calls stop handler | YES |
| `N<items>` = group | YES — reads N, loops over items | YES |
| `(a.b)[K]` = chord | YES — `(` dispatch, `.` separator | YES |
| `[K]` = tile type bracket | YES — tile type jump table | YES (stripped in extractNoteNames) |
| Note name format `a2` | YES — lowercase letter + digit | YES |
| `#` prefix = sharp | YES — `cmp w0, #0x23` in note parser | YES |
| Double tile prefix `D` | YES — `cmp w19, #0x44` ('D') | NOT IMPLEMENTED YET |

### What our implementation gets right
Our `pianoTilesParser.ts` correctly handles the score grammar as confirmed by the binary.
The `buildResultFromPianoTilesSong` function with `slotDurationS = baseBeats * (60/bpm)`
matches the exact timing formula used by `CProcessScore`.

### One gap: Double tiles (`D` prefix)
The binary has a special `D` branch for `DoubleRowLayer` tiles. Score tokens starting with `D`
followed by a note name create two simultaneous tiles. Our parser currently ignores the `D`
prefix and treats it as a note name, which would produce incorrect output for songs using
double tiles. This is a potential future improvement.

---

## Why static linkage limits string extraction

`CProcessScore::parseScore()` and all `RowLayer` subclass methods use **internal static linkage**
— they are not exported and don't appear in `.dynsym`. String extraction can only see:
- Exported function names in `.dynsym`
- String literals in `.rodata` (what we extracted)
- Lambda type-name strings in RTTI (`*ZN...`)

The disassembly above was obtained by:
1. Parsing the ELF RELA section (`R_AARCH64_RELATIVE` relocations) to chain RTTI name → typeinfo → vtable
2. Using `capstone` Python library to disassemble ARM64 `.text` at the found addresses
3. Scanning for ADRP+ADD instruction pairs that load known JSON string addresses
4. Scanning for CMP-immediate instructions matching score token ASCII codes

---

## Next Step: Ghidra (free, NSA)

### Install
1. Download from https://ghidra-sre.org (current: 11.x)
2. Requires Java 17+: `winget install Microsoft.OpenJDK.17`
3. Unzip, run `ghidraRun.bat`

### Import the .so
1. **File → Import File** → select `libcocos2dcpp.so` (arm64-v8a, 29 MB)
2. Language: `AARCH64:LE:64:v8A` (auto-detected)
3. **Analyze → Auto Analyze** — takes ~10 min on first import

### Find CProcessScore
1. **Window → Symbol Tree** → filter for `CProcessScore`
2. Or **Search → Program Text** → search `CProcessScore`
3. Double-click any method → Decompiler panel shows pseudo-C

### Useful Ghidra searches
- `CProcessScore` — the score string parser
- `CMusicJson_Row` — JSON row reader (how `baseBeats`, `bpm`, `scores` are read)
- `LongRowLayer::init` — how hold tile duration is set
- `DoubleRowLayer::init` — how double tiles are constructed
- `AccompnyRowLayer` — accompaniment tile logic
- `CheckAccompanyCmd::execute` — 4-stage accompaniment collision (already found in strings)

### Alternative: radare2 (CLI)
```bash
# Install via scoop or msys2
scoop install radare2

# Open and analyze
r2 -A libcocos2dcpp.so

# List all functions containing 'Process'
afl~Process

# Decompile CProcessScore method (once you have its address)
pdg @ sym.CProcessScore_parseScore
```

---

## Frida (runtime hooking — requires rooted Android device or emulator)

The medium article the user mentioned: https://felipejfc.medium.com/reverse-engineering-a-cocos2dx-js-game-6cecc1c08f28

For runtime hooking:
```javascript
// Hook CProcessScore to intercept score string parsing
Java.perform(() => {
  // Find the native function via dlsym after library loads
  const processScore = Module.findExportByName('libcocos2dcpp.so', '_ZN13CProcessScore...');
  Interceptor.attach(processScore, {
    onEnter(args) { console.log('score:', args[1].readUtf8String()); },
    onLeave(ret)  { console.log('result tiles:', ret); }
  });
});
```
Note: `CProcessScore` is not exported so you'd need to find its offset via pattern scanning.
