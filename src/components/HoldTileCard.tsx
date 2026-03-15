/**
 * HoldTileCard — SVG-based hold progress UI
 *
 * Uses a single SVG <path> for the fill rectangle + dome cap.
 * All per-frame updates go through direct DOM attribute writes (no React re-renders).
 *
 * Geometry:
 *   Fill shape: M 0 H → L W H → L W fillTopY → A domeR domeR 0 0 0 0 fillTopY → Z
 *   domeR = tileWidth (shallow dome, sagitta ≈ 0.134 × W).
 *   Arc sweeps counter-clockwise (sweep-flag 0), apex at the arc dot center.
 */

import { useState, useRef, useEffect } from 'react';
import type { Tile } from '../types/track';
import type { ParsedNote } from '../types/midi';

interface Props {
  tile: Tile;
  tapped: boolean;
  onTap: (tile: Tile) => void;
  onRelease?: () => void;
  onNotePlay?: (notes: ParsedNote[]) => void;
  style?: React.CSSProperties;
  className?: string;
}

// How many px above the anchor the arc dot center sits
const DOT_OFFSET_PX = 50;

export function HoldTileCard({ tile, tapped, onTap, onRelease, onNotePlay, style, className = '' }: Props) {
  // ── React state ──────────────────────────────────────────────────────────
  const [isHeld, setIsHeld] = useState(false);
  const [firedDots, setFiredDots] = useState<Set<number>>(new Set());
  const [arcHitKey, setArcHitKey] = useState(0);

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const divRef = useRef<HTMLDivElement>(null);
  /** The SVG <path> that draws the fill + dome cap. Updated each rAF frame. */
  const fillPathRef = useRef<SVGPathElement>(null);
  /** The SVG <circle> that is the bright arc dot. cy updated each rAF frame. */
  const arcDotRef = useRef<SVGCircleElement>(null);
  /** Expanding ring circle — position synced each frame, animation triggered on beat hit. */
  const rippleRingRef = useRef<SVGCircleElement>(null);
  /** <animate> that drives the ring radius from dot-size to large. */
  const rippleAnimRRef = useRef<SVGAnimateElement>(null);
  /** <animate> that drives the ring opacity from 1 to 0. */
  const rippleAnimOpRef = useRef<SVGAnimateElement>(null);

  // ── Motion refs (no re-render) ────────────────────────────────────────────
  const pointerYRef = useRef(0);
  const isHeldRef = useRef(false);
  const firedSetRef = useRef<Set<number>>(new Set());
  const rafRef = useRef<number>(0);
  const maxProgressRef = useRef(0);
  const reachedPercentRef = useRef(0);

  const onNotePlayRef = useRef(onNotePlay);
  useEffect(() => { onNotePlayRef.current = onNotePlay; }, [onNotePlay]);

  // ── Beat data ────────────────────────────────────────────────────────────
  const primaryNote = tile.notes[0];
  const lastNote = tile.notes[tile.notes.length - 1];
  const totalDuration = lastNote.time + lastNote.duration - primaryNote.time;

  const secondaryBeats = (() => {
    const groups = new Map<number, { time: number; notes: ParsedNote[] }>();
    for (const note of tile.notes) {
      if (note.slotStart === primaryNote.slotStart) continue;
      if (!groups.has(note.slotStart)) {
        groups.set(note.slotStart, { time: note.time, notes: [] });
      }
      groups.get(note.slotStart)!.notes.push(note);
    }
    return Array.from(groups.values())
      .sort((a, b) => a.time - b.time)
      .map(g => ({
        ...g,
        posPercent: totalDuration > 0 ? ((g.time - primaryNote.time) / totalDuration) * 100 : 0,
      }));
  })();

  // ── Beat fire ────────────────────────────────────────────────────────────
  const fireBeat = (idx: number, notes: ParsedNote[]) => {
    firedSetRef.current = new Set([...firedSetRef.current, idx]);
    setFiredDots(new Set(firedSetRef.current));
    setArcHitKey(prev => prev + 1);
    // Trigger the SVG expanding ring — beginElement() restarts the animation
    // from its `from` value even if a previous run is still in progress.
    rippleAnimRRef.current?.beginElement();
    rippleAnimOpRef.current?.beginElement();
    onNotePlayRef.current?.(notes);
  };

  // ── rAF loop ─────────────────────────────────────────────────────────────
  const startRAF = (beats: typeof secondaryBeats) => {
    const loop = () => {
      if (!isHeldRef.current || !divRef.current) return;

      const rect = divRef.current.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;

      const reachedPercent = (rect.bottom - pointerYRef.current) / H * 100;
      reachedPercentRef.current = reachedPercent;

      const dotOffsetPercent = (DOT_OFFSET_PX / H) * 100;
      const clampedPercent = Math.max(0, Math.min(100 - dotOffsetPercent, reachedPercent));
      maxProgressRef.current = Math.max(maxProgressRef.current, clampedPercent);
      const displayPercent = maxProgressRef.current;

      // ── SVG coordinates (y = 0 at top, y = H at bottom) ───────────────
      // Anchor: the raw "bottom: displayPercent%" position in pixel space
      const anchorY = H * (1 - displayPercent / 100);

      // The arc dot (glow dot) center — DOT_OFFSET_PX above the anchor.
      // This is ALSO the dome apex: the topmost point of the fill shape.
      const dotY = anchorY - DOT_OFFSET_PX;

      // Dome radius matches V1's CSS: use the full tile width as the circle
      // radius. This gives a very shallow dome: sagitta ≈ 0.134 × W (≈ 8 px
      // for a 60 px lane) — the same subtle curve the CSS version produces.
      const domeR = W;
      // Sagitta = how far the dome arc sits above fillTopY (= dome height).
      // For a chord of length W and radius domeR:
      //   s = r − √(r² − (W/2)²)
      const sagitta = domeR - Math.sqrt(domeR * domeR - (W * W) / 4);

      // The rectangle part of the fill ends at fillTopY.
      // The dome arc rises from fillTopY up to dotY (the apex).
      const fillTopY = dotY + sagitta;

      // ── Update fill path ───────────────────────────────────────────────
      if (fillPathRef.current) {
        let d: string;
        if (dotY <= 0) {
          // Dot has reached the tile top — fill the whole tile
          d = `M 0 ${H} L ${W} ${H} L ${W} 0 L 0 0 Z`;
        } else {
          // Rectangle from bottom to fillTopY, then dome arc up to dotY.
          // Arc: from (W, fillTopY) counter-clockwise to (0, fillTopY)
          //   sweep-flag=0 → curves upward; apex at (W/2, dotY)
          d = `M 0 ${H} L ${W} ${H} L ${W} ${fillTopY} A ${domeR} ${domeR} 0 0 0 0 ${fillTopY} Z`;
        }
        fillPathRef.current.setAttribute('d', d);
      }

      // ── Update arc dot + ripple ring position (same point: dome apex) ──
      const dotCX = String(W / 2);
      const dotCY = String(Math.max(7, dotY));
      if (arcDotRef.current) {
        arcDotRef.current.setAttribute('cy', dotCY);
        arcDotRef.current.setAttribute('cx', dotCX);
      }
      if (rippleRingRef.current) {
        rippleRingRef.current.setAttribute('cy', dotCY);
        rippleRingRef.current.setAttribute('cx', dotCX);
      }

      // ── Beat detection ─────────────────────────────────────────────────
      beats.forEach((beat, idx) => {
        if (!firedSetRef.current.has(idx) && reachedPercent >= beat.posPercent - dotOffsetPercent) {
          fireBeat(idx, beat.notes);
        }
      });

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  // ── Pointer handlers ─────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tapped) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    pointerYRef.current = e.clientY;
    firedSetRef.current = new Set();
    reachedPercentRef.current = 0;
    maxProgressRef.current = 0;
    isHeldRef.current = true;
    setIsHeld(true);
    setFiredDots(new Set());
    setArcHitKey(0);

    // Clear the fill path so it starts empty
    if (fillPathRef.current) fillPathRef.current.setAttribute('d', '');

    startRAF(secondaryBeats);
    onTap(tile);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isHeldRef.current) pointerYRef.current = e.clientY;
  };

  const handleRelease = () => {
    isHeldRef.current = false;
    cancelAnimationFrame(rafRef.current);
    setIsHeld(false);
    setFiredDots(new Set());
    setArcHitKey(0);
    firedSetRef.current = new Set();

    // Auto-complete: if within 20px of top, seal the tile with a full rectangle
    if (fillPathRef.current && divRef.current) {
      const rect = divRef.current.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      const dotOffsetPercent = (DOT_OFFSET_PX / H) * 100;
      const remainingPx = (100 - maxProgressRef.current - dotOffsetPercent) / 100 * H;
      if (remainingPx <= 20) {
        fillPathRef.current.setAttribute('d', `M 0 ${H} L ${W} ${H} L ${W} 0 L 0 0 Z`);
      }
      // Otherwise: leave the path as-is so the fill stays at the reached height
    }

    onRelease?.();
  };

  useEffect(() => {
    return () => { cancelAnimationFrame(rafRef.current); };
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={divRef}
      className={`game-tile game-tile--hold${isHeld ? ' game-tile--hold-active' : ''}${tapped ? ' game-tile--tapped' : ''} ${className}`}
      style={{ ...style, overflow: 'hidden' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handleRelease}
      onPointerCancel={handleRelease}
    >
      {/* Background radial haze (CSS, unchanged) */}
      <div className="game-tile__hold-glow" />

      {/* Laser line (CSS, unchanged) */}
      <div className="game-tile__hold-line" />

      {/*
        SVG overlay — covers the full tile.
        Contains:
          • fill path (fill + dome cap, updated each rAF frame)
          • secondary beat dots (% positions, color from React state)
          • arc dot (cy updated each rAF frame)
        z-index 2 puts it above the laser line (z-index 1) but below the ring (z-index 4).
      */}
      <svg
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2, overflow: 'hidden' }}
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* ── Fill + dome ──────────────────────────────────────────────── */}
        <path
          ref={fillPathRef}
          d=""
          fill="#308af1"
        />

        {/* ── Secondary beat dots — shown only while holding ───────────── */}
        {isHeld && secondaryBeats.map((beat, idx) => (
          <circle
            key={idx}
            cx="50%"
            cy={`${100 - beat.posPercent}%`}
            r="3"
            fill={firedDots.has(idx) ? 'rgba(0,200,255,0.2)' : 'rgba(0,210,255,0.65)'}
          />
        ))}

        {/*
          ── Ripple ring — expands outward on each beat hit ────────────────
          Position (cx/cy) is synced with the arc dot every rAF frame.
          The two <animate> children are triggered imperatively via
          beginElement() in fireBeat — no React key remounting needed.
            r:       7 → 42  (expands from dot radius to ~3× size)
            opacity: 1 → 0   (fades out as it expands)
          begin="indefinite" means the animation only runs when beginElement()
          is called, and restarts cleanly if called again mid-flight.
        */}
        {isHeld && (
          <circle ref={rippleRingRef} cx="50%" cy="-100" r="7"
            fill="none" stroke="rgba(0,200,255,0.9)" strokeWidth="2" opacity="0"
          >
            <animate ref={rippleAnimRRef}
              attributeName="r" from="7" to="42"
              dur="0.45s" begin="indefinite" fill="freeze"
            />
            <animate ref={rippleAnimOpRef}
              attributeName="opacity" from="1" to="0"
              dur="0.45s" begin="indefinite" fill="freeze"
            />
          </circle>
        )}

        {/*
          ── Moving arc dot ───────────────────────────────────────────────
          cx/cy are updated each frame via arcDotRef.
          Initially placed off-screen (cy=-100) so the first rAF frame
          moves it into position before it's visible.
          key=arcHitKey remounts the element on each beat hit, restarting
          the CSS svgArcDotDim animation (dim → brighten).
        */}
        {isHeld && (
          <circle
            key={arcHitKey}
            ref={arcDotRef}
            cx="50%"
            cy="-100"
            r="7"
            fill="white"
            className={arcHitKey > 0 ? 'svg-arc-dot svg-arc-dot--ripple' : 'svg-arc-dot'}
          />
        )}
      </svg>

      {/* Tap ring at the bottom — hidden once held or tapped */}
      {!tapped && !isHeld && <div className="game-tile__hold-ring" />}
    </div>
  );
}
