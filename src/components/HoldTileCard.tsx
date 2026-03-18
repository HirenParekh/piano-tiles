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

import { useState, useRef, useEffect, useMemo, memo } from 'react';
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
  /** Height of a single slot in px (MIN_HEIGHT × scaleRatio). Used for the background gradient. */
  singleTileH?: number;
}

// How many px above the anchor the arc dot center sits
const DOT_OFFSET_PX = 50;

export const HoldTileCard = memo(function HoldTileCard({ tile, tapped, onTap, onRelease, onNotePlay, style, className = '', singleTileH = 100 }: Props) {
  // ── React state ──────────────────────────────────────────────────────────
  const [isHeld, setIsHeld] = useState(false);
  const [firedDots, setFiredDots] = useState<Set<number>>(new Set());
  const [arcHitKey, setArcHitKey] = useState(0);
  const [tapYFromBottom, setTapYFromBottom] = useState(0);

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
  const tapYFromBottomRef = useRef(0);
  const isHeldRef = useRef(false);
  const firedSetRef = useRef<Set<number>>(new Set());
  const rafRef = useRef<number>(0);
  const maxProgressRef = useRef(0);
  const reachedPercentRef = useRef(0);
  // Arc dot radius computed once at hold-start from tile width so it scales
  // with the lane width instead of being a fixed 7px on all screen sizes.
  const arcDotRRef = useRef(7);
  // Tile dimensions cached at hold-start — W/H don't change during a hold,
  // so we avoid calling getBoundingClientRect() for them every rAF frame.
  const cachedWRef = useRef(0);
  const cachedHRef = useRef(0);

  const onNotePlayRef = useRef(onNotePlay);
  useEffect(() => { onNotePlayRef.current = onNotePlay; }, [onNotePlay]);

  // ── Beat data ────────────────────────────────────────────────────────────
  const primaryNote = tile.notes[0];

  // slotOffset: how many slots above the primary note each beat group starts.
  // Dot position = tapYFromBottom + slotOffset * singleTileH (px from bottom).
  // tile.notes is stable (immutable track data), so this computes once per tile.
  const secondaryBeats = useMemo(() => {
    const groups = new Map<number, { slotStart: number; time: number; notes: ParsedNote[] }>();
    for (const note of tile.notes) {
      if (note.slotStart === primaryNote.slotStart) continue;
      if (!groups.has(note.slotStart)) {
        groups.set(note.slotStart, { slotStart: note.slotStart, time: note.time, notes: [] });
      }
      groups.get(note.slotStart)!.notes.push(note);
    }
    return Array.from(groups.values())
      .sort((a, b) => a.time - b.time)
      .map(g => ({
        ...g,
        slotOffset: g.slotStart - primaryNote.slotStart,
      }));
  }, [tile.notes, primaryNote.slotStart]);

  // ── Beat fire ────────────────────────────────────────────────────────────
  const fireBeat = (idx: number, notes: ParsedNote[]) => {
    firedSetRef.current = new Set([...firedSetRef.current, idx]);
    setFiredDots(new Set(firedSetRef.current));
    setArcHitKey(prev => prev + 1);
    // Scale ripple from arc-dot size outward — proportional to tile width.
    if (rippleAnimRRef.current) {
      const toR = Math.round((divRef.current?.clientWidth ?? 60) * 0.45);
      rippleAnimRRef.current.setAttribute('from', String(arcDotRRef.current));
      rippleAnimRRef.current.setAttribute('to', String(toR));
    }
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

      // W and H are cached at hold-start (tile dimensions don't change during hold).
      // Only .bottom needs a live query since the tile moves with the scroll.
      const W = cachedWRef.current;
      const H = cachedHRef.current;
      const bottom = divRef.current.getBoundingClientRect().bottom;

      const reachedPercent = (bottom - pointerYRef.current) / H * 100;
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
      // Keep the dot at least arcDotR px from the top edge so it doesn't clip
      const dotCY = String(Math.max(arcDotRRef.current, dotY));
      if (arcDotRef.current) {
        arcDotRef.current.setAttribute('cy', dotCY);
        arcDotRef.current.setAttribute('cx', dotCX);
        // r is set every frame so it stays correct after key-remount on beat hit
        arcDotRef.current.setAttribute('r', String(arcDotRRef.current));
      }
      if (rippleRingRef.current) {
        rippleRingRef.current.setAttribute('cy', dotCY);
        rippleRingRef.current.setAttribute('cx', dotCX);
      }

      // ── Beat detection ─────────────────────────────────────────────────
      beats.forEach((beat, idx) => {
        const dotPxFromBottom = tapYFromBottomRef.current + beat.slotOffset * singleTileH;
        if (dotPxFromBottom > H) return; // doesn't fit in remaining tile, skip
        const dotPercent = (dotPxFromBottom / H) * 100;
        if (!firedSetRef.current.has(idx) && reachedPercent >= dotPercent - dotOffsetPercent) {
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
    const tapRect = divRef.current!.getBoundingClientRect();
    tapYFromBottomRef.current = tapRect.bottom - e.clientY;
    // Cache W/H for the rAF loop — tile dimensions are fixed during a hold
    cachedWRef.current = tapRect.width;
    cachedHRef.current = tapRect.height;
    // ~6% of lane width; clamp to at least 5px so it's always visible
    arcDotRRef.current = Math.min(10, Math.round(tapRect.width * 0.06));
    setTapYFromBottom(tapRect.bottom - e.clientY);
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
      const W = cachedWRef.current;
      const H = cachedHRef.current;
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
      style={{ ...style, overflow: 'visible', background: `linear-gradient(to top, #000000 ${singleTileH * 0.4}px, #0e3a6e ${singleTileH}px, #1565c0 100%)` }}
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
          • defs: glow filter (arc dot halo) + speed gradient (fill)
          • fill path (fill + dome cap, updated each rAF frame)
          • secondary beat dots (% positions, color from React state)
          • ripple ring (expands on beat hit)
          • arc dot (cy updated each rAF frame, glowing)
        z-index 2 puts it above the laser line (z-index 1) but below the ring (z-index 4).
      */}
      <svg
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2, overflow: 'hidden' }}
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/*
            Glow filter for the arc dot.
            feGaussianBlur creates a soft cyan halo; feMerge layers it behind the sharp dot.
            Wide filter region (300%×300%) prevents the bloom from being clipped at edges.
          */}
          <filter id={`arcGlow-${tile.id}`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/*
            Speed gradient for the fill path.
            Top (dome apex) is bright cyan-white — the leading edge of the fill.
            It fades to the base blue below, giving the impression of the fill
            rushing upward with a glowing front.
          */}
          {/*
            Speed gradient for the fill path — bright light blue at the dome
            apex (leading edge), fading to base blue at the bottom.
          */}
          <linearGradient id={`fillGrad-${tile.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="rgba(70, 170, 235, 1.0)" />
            <stop offset="8%"   stopColor="rgba(55, 150, 225, 0.99)" />
            <stop offset="35%"  stopColor="#308af1" />
            <stop offset="100%" stopColor="#1a6bc8" />
          </linearGradient>

        </defs>

        {/* ── Fill + dome — gradient gives a bright glowing leading edge ── */}
        <path
          ref={fillPathRef}
          d=""
          fill={`url(#fillGrad-${tile.id})`}
        />

        {/* ── Secondary beat dots — shown only while holding ───────────── */}
        {isHeld && (() => {
          const tileH = divRef.current?.clientHeight ?? 0;
          const tileW = divRef.current?.clientWidth ?? 0;
          // Dot radius is proportional to tile width — looks correct at all screen sizes.
          // ~3% of lane width gives a dot that's clearly visible but not overwhelming.
          const dotR = Math.round(tileW * 0.03)
          return secondaryBeats.map((beat, idx) => {
            const dotPxFromBottom = tapYFromBottom + beat.slotOffset * singleTileH;
            if (dotPxFromBottom > tileH) return null; // doesn't fit
            const cy = tileH - dotPxFromBottom;
            return (
              <circle
                key={idx}
                cx="50%"
                cy={cy}
                r={dotR}
                // Bright cyan when pending, dim when already fired
                fill={firedDots.has(idx) ? 'rgba(0,200,255,0.2)' : 'rgba(120,220,255,0.9)'}
              />
            );
          });
        })()}

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
            // Glow filter adds a bright cyan bloom around the dot
            filter={`url(#arcGlow-${tile.id})`}
            className={arcHitKey > 0 ? 'svg-arc-dot svg-arc-dot--ripple' : 'svg-arc-dot'}
          />
        )}
      </svg>

      {/* Tap ring at the bottom — hidden once held or tapped */}
      {!tapped && !isHeld && <div className="game-tile__hold-ring" />}
    </div>
  );
}, (prev, next) =>
  // Skip re-render unless a meaningful prop changed.
  // `style` is intentionally excluded — values are derived from immutable tile
  // properties and are structurally identical across renders for the same tile.
  prev.tapped === next.tapped &&
  prev.tile === next.tile &&
  prev.singleTileH === next.singleTileH &&
  prev.onTap === next.onTap &&
  prev.onRelease === next.onRelease &&
  prev.onNotePlay === next.onNotePlay
);
