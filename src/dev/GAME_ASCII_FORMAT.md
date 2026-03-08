# Multi-Lane Grid ASCII Format

A text-based visualization format designed to explicitly communicate the visual layout of tiles falling on our 4-lane game grid. This format ignores raw musical `score strings` or chord merges, focusing purely on spatial placement.

Because explaining multi-lane gameplay via screenshots is inefficient across text or debugging environments, this standardized ASCII representation serves as our primary shorthand for discussing tile layouts, durations, and multi-finger chord placement logic.

## Visual Format Specification

We use a simple 4-column ASCII string separated by spaces to represent the 4 screen lanes from left to right.

*   `_` (underscore) represents an empty slot.
*   Numeric digits (e.g., `1`, `2`) represent unique descending tiles.
*   A number repeating vertically on consecutive rows indicates a **Hold Tile** spanning multiple slots.

## Examples

### 1. Basic Taps and Holds

```text
_ _ _ 1    <-- Tile 1 in Lane 4 (Short Tap/1 Slot)
_ 2 _ _    <-- Tile 2 in Lane 2 (Short Tap)
_ _ 3 _    <-- Tile 3 in Lane 3 (Hold Tile starts)
_ _ 3 _    <-- Tile 3 continues (duration = 2 Slots)
4 _ _ _    <-- Tile 4 in Lane 1 (Short Tap)
```

### 2. Multi-Finger Chords (Multi-Lane Parallel)

When true multi-lane grid mechanics are enabled, concurrent chords (which must be tapped simultaneously with two fingers) map to exactly parallel rows.

```text
_ 1 _ _    <-- Tile 1 single tap
_ _ 2 3    <-- Tiles 2 and 3 fall simultaneously (2-finger tap required)
_ 4 _ 5    <-- Simultaneous tiles split across extreme lanes
_ _ 6 _    <-- Tile 6 Hold Tile starts
_ _ 6 _    <-- Tile 6 Hold Tile continues
```
