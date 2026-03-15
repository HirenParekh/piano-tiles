import { useState, useRef, useEffect } from 'react';
import type { Tile } from '../types/track';
import type { ParsedNote } from '../types/midi';

interface Props {
  tile: Tile;
  /** True for 150ms after first tap — used by parent to flash visual feedback */
  tapped: boolean;
  /** Called once on pointer-down so the parent can play the primary (first) note */
  onTap: (tile: Tile) => void;
  /** Called on pointer-up/cancel so the parent can release the sustained primary note */
  onRelease?: () => void;
  /**
   * Called each time the finger reaches a secondary beat dot while sliding.
   * The parent plays the notes in that beat group.
   * NOT called for the first beat — that's handled by onTap.
   */
  onNotePlay?: (notes: ParsedNote[]) => void;
  style?: React.CSSProperties;
  className?: string;
}

export function HoldTileCard({ tile, tapped, onTap, onRelease, onNotePlay, style, className = '' }: Props) {
  // ── React state (drives CSS class changes / re-renders) ─────────────────
  const [isHeld, setIsHeld] = useState(false);
  // Which dot indices have been triggered — used to apply the --fired CSS class
  const [firedDots, setFiredDots] = useState<Set<number>>(new Set());
  /**
   * Incremented each time the arc dot hits a secondary beat.
   * Using it as `key` on the arc dot element forces React to unmount + remount it,
   * which restarts the CSS ripple animation from the beginning.
   * arcHitKey > 0 means at least one beat has been hit → apply the --ripple class.
   */
  const [arcHitKey, setArcHitKey] = useState(0);

  // ── Refs (don't trigger re-renders, safe to read inside rAF loop) ────────
  /** DOM node of this tile — needed for getBoundingClientRect() in the rAF loop */
  const divRef = useRef<HTMLDivElement>(null);
  /**
   * DOM node of the arc container.
   * We update its `bottom` style directly every animation frame (no React re-render)
   * so the arc tracks the finger position at 60fps without any state overhead.
   */
  const arcRef = useRef<HTMLDivElement>(null);
  /**
   * DOM node of the lighter-blue fill overlay.
   * Its `height` is updated each frame to match the clamped arc position,
   * visually covering dots and the laser line below the current progress point.
   */
  const fillRef = useRef<HTMLDivElement>(null);
  /** Latest pointer clientY — updated every pointermove, read by rAF loop */
  const pointerYRef = useRef(0);
  /** Mirror of isHeld state, but readable inside rAF without stale closure */
  const isHeldRef = useRef(false);
  /** Mirror of firedDots state — ref copy avoids stale closure inside rAF */
  const firedSetRef = useRef<Set<number>>(new Set());
  /** requestAnimationFrame handle — kept so we can cancel on release/unmount */
  const rafRef = useRef<number>(0);
  /**
   * High-watermark: the highest clampedPercent reached in this hold session.
   * Arc and fill only move UP — moving the finger back down does not retract them.
   * Reset to 0 at the start of each new hold.
   */
  const maxProgressRef = useRef(0);
  /**
   * Stores the most recent reachedPercent computed in the rAF loop.
   * Used to set the arc's initial `bottom` style when it first mounts
   * (so there's no one-frame jump from 0% to the real position).
   */
  const reachedPercentRef = useRef(0);
  /**
   * Always-current ref to onNotePlay prop.
   * The rAF loop lives in a closure captured at pointer-down time, so it would
   * see a stale onNotePlay if we used the prop directly. Storing it in a ref
   * and syncing with useEffect means the loop always calls the latest version.
   */
  const onNotePlayRef = useRef(onNotePlay);
  useEffect(() => { onNotePlayRef.current = onNotePlay; }, [onNotePlay]);

  // ── Beat data ────────────────────────────────────────────────────────────
  const primaryNote = tile.notes[0];
  const lastNote = tile.notes[tile.notes.length - 1];
  /** Total wall-clock duration of this hold tile in seconds (first note start → last note end) */
  const totalDuration = lastNote.time + lastNote.duration - primaryNote.time;

  /**
   * Build one entry per unique beat AFTER the first beat.
   *
   * Multiple notes can share the same slotStart (e.g. a chord: g[L] + e1[L] both
   * at the same time position). Those collapse into a single dot so we don't render
   * two overlapping dots or fire the audio callback twice for the same beat.
   *
   * posPercent is the dot's vertical position from the BOTTOM of the tile (0% = ring, 100% = top).
   * It equals what percentage of the tile's height the finger needs to travel to reach that beat.
   */
  const secondaryBeats = (() => {
    // Map<slotStart, { time, notes[] }>  — one entry per unique time position
    const groups = new Map<number, { time: number; notes: ParsedNote[] }>();
    for (const note of tile.notes) {
      // Skip notes that belong to the primary beat (they already play via onTap)
      if (note.slotStart === primaryNote.slotStart) continue;
      if (!groups.has(note.slotStart)) {
        groups.set(note.slotStart, { time: note.time, notes: [] });
      }
      groups.get(note.slotStart)!.notes.push(note);
    }
    return Array.from(groups.values())
      .sort((a, b) => a.time - b.time) // ensure chronological order
      .map(g => ({
        ...g,
        // posPercent: what % of the tile height from the bottom is this beat?
        // e.g. a beat halfway through the hold = 50%
        posPercent: totalDuration > 0 ? ((g.time - primaryNote.time) / totalDuration) * 100 : 0,
      }));
  })();

  // ── Audio + visual trigger for one beat ──────────────────────────────────
  /**
   * Mark beat `idx` as fired:
   *   1. Update firedSetRef (ref — readable by rAF without re-render)
   *   2. Update firedDots state (triggers re-render → CSS --fired class dims the static dot)
   *   3. Increment arcHitKey (triggers re-render → arc dot remounts → ripple animation restarts)
   *   4. Call onNotePlay so the parent plays the audio notes for this beat
   */
  const fireBeat = (idx: number, notes: ParsedNote[]) => {
    firedSetRef.current = new Set([...firedSetRef.current, idx]);
    setFiredDots(new Set(firedSetRef.current));
    setArcHitKey(prev => prev + 1); // remount arc dot → restart ripple animation
    onNotePlayRef.current?.(notes);
  };

  // ── Position-based beat detection + arc position update loop ─────────────
  /**
   * Runs every animation frame while the user is holding.
   *
   * Each frame it computes how far UP the tile the finger has reached:
   *
   *   reachedPercent = (tile.bottom - fingerY) / tile.height × 100
   *
   * At the moment of tap the finger is near the ring (tile.bottom ≈ fingerY) → ~0%.
   * Two ways reachedPercent grows:
   *   • Sandbox (static tile): user physically slides finger UP → fingerY decreases
   *   • Scrolling game: tile moves DOWN past stationary finger → tile.bottom increases
   *
   * The arc container's `bottom` CSS is updated directly via DOM (no React re-render)
   * so the arc tracks the position smoothly at 60fps.
   *
   * When reachedPercent crosses a beat's posPercent threshold, fireBeat() is called.
   * firedSetRef prevents a beat from firing more than once per hold session.
   */
  const startRAF = (beats: typeof secondaryBeats) => {
    const loop = () => {
      // Stop if released or DOM node gone
      if (!isHeldRef.current || !divRef.current) return;

      const rect = divRef.current.getBoundingClientRect();
      const reachedPercent = (rect.bottom - pointerYRef.current) / rect.height * 100;

      // Keep the ref current so JSX can use it for the arc's initial bottom style
      reachedPercentRef.current = reachedPercent;

      // The arc dot center is 50px above the anchor.
      // Convert to a percentage of the tile height — used for both clamping and beat detection.
      const dotOffsetPercent = (50 / rect.height) * 100;

      // Clamp the anchor so the arc dot never exits the tile:
      //   min 0%   → dot bottom-edge is 43px above tile bottom (can't go below)
      //   max (100 - dotOffsetPercent)% → arc dot CENTER sits exactly at the tile top edge
      const clampedPercent = Math.max(0, Math.min(100 - dotOffsetPercent, reachedPercent));

      // High-watermark: arc and fill only ever advance upward.
      // Moving the finger back down does not retract the progress indicator.
      maxProgressRef.current = Math.max(maxProgressRef.current, clampedPercent);
      const displayPercent = maxProgressRef.current;

      // Move the arc container to the high-watermark position — direct DOM, no re-render
      if (arcRef.current) {
        arcRef.current.style.bottom = `${displayPercent}%`;
      }

      // Expand the fill overlay up to the arc dot CENTER (anchor + 50px offset).
      // This covers the dark gradient below the arc with solid blue, matching the
      // original game's "already played" region. Cap at 100% to stay within the tile.
      if (fillRef.current) {
        fillRef.current.style.height = `${Math.min(100, displayPercent + dotOffsetPercent)}%`;
      }

      // Check if any secondary beat has been reached and not yet fired.
      // We subtract dotOffsetPercent so the beat fires when the arc dot (50px above
      // the anchor) reaches the static dot, not when the anchor itself does.
      beats.forEach((beat, idx) => {
        if (!firedSetRef.current.has(idx) && reachedPercent >= beat.posPercent - dotOffsetPercent) {
          fireBeat(idx, beat.notes);
        }
      });

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  // ── Pointer event handlers ───────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tapped) return; // tile already played — ignore any further touches
    e.preventDefault(); // prevent text selection, default browser gestures
    // Capture keeps pointermove/up firing on THIS element even if finger leaves it
    e.currentTarget.setPointerCapture(e.pointerId);

    pointerYRef.current = e.clientY;
    firedSetRef.current = new Set(); // reset fired set for this new hold session
    reachedPercentRef.current = 0;   // arc starts at the bottom
    maxProgressRef.current = 0;      // reset high-watermark for this hold session
    isHeldRef.current = true;
    setIsHeld(true);        // → adds game-tile--hold-active class → ring + dots light up
    setFiredDots(new Set()); // reset dot states
    setArcHitKey(0);        // reset arc ripple counter
    if (fillRef.current) {
      fillRef.current.style.height = '0%'; // reset fill overlay
      fillRef.current.classList.remove('game-tile__hold-fill--complete'); // remove flat-dome state
    }

    startRAF(secondaryBeats); // begin per-frame beat detection + arc tracking
    onTap(tile);               // tell parent to play primary note (attackNote)
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // Keep pointerYRef fresh so the rAF loop always uses the latest finger position
    if (isHeldRef.current) pointerYRef.current = e.clientY;
  };

  const handleRelease = () => {
    isHeldRef.current = false;
    cancelAnimationFrame(rafRef.current); // stop the rAF loop
    setIsHeld(false);        // → removes hold-active class → ring + dots dim, arc unmounts
    setFiredDots(new Set()); // reset dot visuals
    setArcHitKey(0);
    firedSetRef.current = new Set();

    // Auto-complete detection: if the fill reached within 20px of the tile top,
    // treat it as a successful full hold and reset the fill cleanly to 0%.
    // If the user released too early (gap > 20px), leave the fill at the
    // reached height so they can see how far they got.
    if (fillRef.current && divRef.current) {
      const tileHeight = divRef.current.getBoundingClientRect().height;
      if (tileHeight > 0) {
        const dotOffsetPct = (50 / tileHeight) * 100;
        // How many px of tile remain above the fill's top edge
        const remainingPx = (100 - maxProgressRef.current - dotOffsetPct) / 100 * tileHeight;
        if (remainingPx <= 20) {
          // Auto-complete: fill the tile fully and flatten the dome head.
          // border-radius on ::after can't be set directly via JS, so we add a
          // CSS class that overrides it to 0, making it a flat rectangle.
          fillRef.current.style.height = '100%';
          fillRef.current.classList.add('game-tile__hold-fill--complete');
        }
      }
    }

    onRelease?.();           // tell parent to release the sustained primary note
  };

  // Cancel rAF if the component unmounts mid-hold (e.g. song ends)
  useEffect(() => {
    return () => { cancelAnimationFrame(rafRef.current); };
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={divRef}
      className={`game-tile game-tile--hold${isHeld ? ' game-tile--hold-active' : ''}${tapped ? ' game-tile--tapped' : ''} ${className}`}
      style={{ ...style }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handleRelease}
      onPointerCancel={handleRelease}
    >
      {/* Radial haze centered on the vertical axis — bright center, dark edges */}
      <div className="game-tile__hold-glow" />

      {/* Thin vertical laser line from tile top down to the ring — the comet trail */}
      <div className="game-tile__hold-line" />

      {/*
        One dot per secondary beat.
        `bottom: posPercent%` places the dot at the exact vertical position the
        finger must reach to trigger that beat.
        When fired, the --fired class dims the dot (the arc dot handles the ripple).
      */}
      {secondaryBeats.map((beat, idx) => (
        <div
          key={idx}
          className={`game-tile__hold-dot${firedDots.has(idx) ? ' game-tile__hold-dot--fired' : ''}`}
          style={{ bottom: `${beat.posPercent}%` }}
        />
      ))}

      {/*
        Lighter-blue fill overlay — covers dots and laser line in the "already played"
        region below the arc. Height is driven by fillRef.current.style.height each frame.
        Rendered always so the ref is attached; starts at height 0 (invisible).
      */}
      <div ref={fillRef} className="game-tile__hold-fill" />

      {/*
        Moving arc + center dot — only rendered while holding.

        Position is updated every frame via arcRef.current.style.bottom (no React re-render).
        `reachedPercentRef.current` sets the initial bottom so it's already in the right
        place on the first render frame (avoids a jump from 0% to the real position).

        The inner dot uses `key={arcHitKey}`: each time arcHitKey increments (on beat hit),
        React remounts the dot element, which restarts the CSS --ripple animation from scratch.
        arcHitKey > 0 means at least one beat has been crossed → apply the ripple class.
      */}
      {isHeld && (
        <div
          ref={arcRef}
          className="game-tile__hold-arc"
          style={{ bottom: `${reachedPercentRef.current}%` }}
        >
          <div
            key={arcHitKey}
            className={`game-tile__hold-arc-dot${arcHitKey > 0 ? ' game-tile__hold-arc-dot--ripple' : ''}`}
          />
        </div>
      )}

      {/*
        The tap ring at the bottom — visible only before the tile has ever been tapped.
        Once tapped (tapped=true) it's gone permanently; the fill overlay takes over visually.
      */}
      {!tapped && !isHeld && <div className="game-tile__hold-ring" />}
    </div>
  );
}
