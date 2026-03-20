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
  onTap: (tile: Tile) => void;
  onRelease?: () => void;
  onNotePlay?: (notes: ParsedNote[]) => void;
  style?: React.CSSProperties;
  className?: string;
  /** Height of a single slot in px (MIN_HEIGHT × scaleRatio). Used for the background gradient. */
  singleTileH?: number;
  /** Playback speed multiplier — scales beat animation duration. Defaults to 1. */
  speed?: number;
  /** Ref to the scrollable viewport div. Used to read canvas transform instead of
   *  calling getBoundingClientRect() every rAF frame, avoiding forced reflows. */
  scrollRef?: React.RefObject<HTMLDivElement>;
}

// How many px above the anchor the arc dot center sits
const DOT_OFFSET_PX = 50;

export const HoldTileCard = memo(function HoldTileCard({ tile, onTap, onRelease, onNotePlay, style, className = '', singleTileH = 100, speed = 1, scrollRef }: Props) {
  // ── React state ──────────────────────────────────────────────────────────
  const [isTapped, setIsTapped] = useState(false);
  const [isHeld, setIsHeld] = useState(false);
  const [firedDots, setFiredDots] = useState<Set<number>>(new Set());
  const [tapYFromBottom, setTapYFromBottom] = useState(0);

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const divRef = useRef<HTMLDivElement>(null);
  /** The SVG <path> that draws the fill + dome cap. Updated each rAF frame. */
  const fillPathRef = useRef<SVGPathElement>(null);
  /** The SVG <circle> for the transient beat-hit dot. cx/cy updated each rAF frame; invisible between beats. */
  const arcDotRef = useRef<SVGCircleElement>(null);
  /** <animate> that drives the arc dot radius: grows from static-dot size to arc-dot size, then shrinks to 0. */
  const arcDotAnimRRef = useRef<SVGAnimateElement>(null);
  /** <animate> that drives the arc dot opacity: 0 → 1 → 0 (appear on beat, disappear after). */
  const arcDotAnimOpRef = useRef<SVGAnimateElement>(null);
  /** Thick blurred glow ring — the soft outer spread of the ripple. */
  const rippleRingRef = useRef<SVGCircleElement>(null);
  const rippleAnimRRef = useRef<SVGAnimateElement>(null);
  const rippleAnimOpRef = useRef<SVGAnimateElement>(null);
  /** Thin sharp edge ring — drawn on top of the glow to give a crisp inner boundary. */
  const rippleEdgeRef = useRef<SVGCircleElement>(null);
  const rippleEdgeAnimRRef = useRef<SVGAnimateElement>(null);
  const rippleEdgeAnimOpRef = useRef<SVGAnimateElement>(null);
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
  // Reflow-free bottom tracking: cache tile bottom + canvas Y at hold-start,
  // then derive live bottom from canvas style.transform each frame (no reflow).
  const cachedTileBottomAtStartRef = useRef(0);
  const cachedCanvasYAtStartRef = useRef(0);
  const cachedCanvasElRef = useRef<HTMLElement | null>(null);

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

    const W = cachedWRef.current || divRef.current?.clientWidth || 60;
    const arcR = arcDotRRef.current;
    // Static dot radius matches what's rendered in secondaryBeats below (~3% of width)
    const staticR = Math.round(W * 0.03);
    // Animation duration scales inversely with speed so fast songs feel snappy
    const dur = `${(0.2 / speed).toFixed(3)}s`;

    // Arc dot burst: grow from static-dot size → arc-dot size → shrink to 0
    if (arcDotAnimRRef.current) {
      arcDotAnimRRef.current.setAttribute('values', `${staticR};${arcR};${arcR};0`);
      arcDotAnimRRef.current.setAttribute('keyTimes', '0;0.2;0.65;1');
      arcDotAnimRRef.current.setAttribute('dur', dur);
      arcDotAnimRRef.current.beginElement();
    }
    if (arcDotAnimOpRef.current) {
      arcDotAnimOpRef.current.setAttribute('dur', dur);
      arcDotAnimOpRef.current.beginElement();
    }

    // Scale ripple from arc-dot size outward — proportional to tile width.
    const fromR = Math.round(arcR * 3); // starts already outside the dot
    const toR = Math.round(W * 0.3);

    // Glow ring (thick, blurred)
    if (rippleAnimRRef.current) {
      rippleAnimRRef.current.setAttribute('from', String(fromR));
      rippleAnimRRef.current.setAttribute('to', String(toR));
      rippleAnimRRef.current.setAttribute('dur', dur);
    }
    if (rippleAnimOpRef.current) {
      rippleAnimOpRef.current.setAttribute('dur', dur);
    }
    rippleAnimRRef.current?.beginElement();
    rippleAnimOpRef.current?.beginElement();

    // Edge ring (thin, sharp) — same r range, slightly faster fade
    if (rippleEdgeAnimRRef.current) {
      rippleEdgeAnimRRef.current.setAttribute('from', String(fromR));
      rippleEdgeAnimRRef.current.setAttribute('to', String(toR));
      rippleEdgeAnimRRef.current.setAttribute('dur', dur);
    }
    if (rippleEdgeAnimOpRef.current) {
      rippleEdgeAnimOpRef.current.setAttribute('dur', dur);
    }
    rippleEdgeAnimRRef.current?.beginElement();
    rippleEdgeAnimOpRef.current?.beginElement();
    onNotePlayRef.current?.(notes);
  };

  // ── rAF loop ─────────────────────────────────────────────────────────────
  const startRAF = (beats: typeof secondaryBeats) => {
    const loop = () => {
      if (!isHeldRef.current || !divRef.current) return;

      const W = cachedWRef.current;
      const H = cachedHRef.current;
      // Reflow-free bottom: tile bottom at hold-start + how much the canvas has
      // scrolled since then (delta of translate3d Y). Falls back to
      // getBoundingClientRect() if scrollRef wasn't provided (e.g. sandbox widget).
      let bottom: number;
      if (cachedCanvasElRef.current) {
        const canvasY = parseFloat(cachedCanvasElRef.current.style.transform.split(',')[1]) || 0;
        bottom = cachedTileBottomAtStartRef.current + (canvasY - cachedCanvasYAtStartRef.current);
      } else {
        bottom = divRef.current.getBoundingClientRect().bottom;
      }

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
        // Note: r and opacity are controlled by SVG <animate> — not set here
      }
      if (rippleRingRef.current) {
        rippleRingRef.current.setAttribute('cy', dotCY);
        rippleRingRef.current.setAttribute('cx', dotCX);
      }
      if (rippleEdgeRef.current) {
        rippleEdgeRef.current.setAttribute('cy', dotCY);
        rippleEdgeRef.current.setAttribute('cx', dotCX);
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
    if (isTapped) return;
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
    // Cache canvas element + starting positions for reflow-free bottom tracking.
    // style.transform = "translate3d(0, Ypx, 0)" — split(',')[1] extracts Y.
    const canvasEl = (scrollRef?.current?.firstElementChild as HTMLElement) ?? null;
    cachedCanvasElRef.current = canvasEl;
    cachedTileBottomAtStartRef.current = tapRect.bottom;
    cachedCanvasYAtStartRef.current = parseFloat(canvasEl?.style.transform.split(',')[1] ?? '0') || 0;
    setTapYFromBottom(tapRect.bottom - e.clientY);
    firedSetRef.current = new Set();
    reachedPercentRef.current = 0;
    maxProgressRef.current = 0;
    isHeldRef.current = true;
    setIsHeld(true);
    setFiredDots(new Set());

    // Reset arc dot to invisible so it only appears on beat hits
    if (arcDotRef.current) {
      arcDotRef.current.setAttribute('r', '0');
      arcDotRef.current.setAttribute('opacity', '0');
    }
    // Clear the fill path so it starts empty
    if (fillPathRef.current) fillPathRef.current.setAttribute('d', '');

    setIsTapped(true);
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
      className={`game-tile game-tile--hold${isHeld ? ' game-tile--hold-active' : ''}${isTapped ? ' game-tile--tapped' : ''} ${className}`}
      data-tile-id={tile.id}
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
          • secondary beat dots (static indicators; disappear when arc fires them)
          • ripple ring (expands on beat hit)
          • arc dot (transient: invisible between beats, bursts on beat hit via SVG animate)
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
            Arc dot filter: pure Gaussian blur — no sharp circle on top.
            The circle becomes a soft, cloud-like glow blob.
            Wide region prevents clipping at the tile edges.
          */}
          <filter id={`arcGlow-${tile.id}`} x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="0.5" />
          </filter>

          {/* Ripple glow filter: pure blur for the thick background ring. */}
          <filter id={`rippleGlow-${tile.id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
          </filter>

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

        {/* ── Secondary beat dots — static indicators for upcoming notes ── */}
        {/* Each dot disappears (opacity 0) the moment the arc fires it,    */}
        {/* giving the illusion that the arc "picks up" the dot as it passes. */}
        {isHeld && (() => {
          const tileH = cachedHRef.current || divRef.current?.clientHeight || 0;
          const tileW = cachedWRef.current || divRef.current?.clientWidth || 0;
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
                fill="rgba(120,220,255,0.9)"
                // Disappear immediately when fired — the arc dot burst takes over visually
                opacity={firedDots.has(idx) ? 0 : 1}
              />
            );
          });
        })()}

        {/*
          ── Ripple ring — two layers for a blue→transparent gradient feel ──
          Layer 1 (glow): thick blurred stroke — the soft outer spread.
          Layer 2 (edge): thin sharp stroke on top — the crisp inner boundary.
          Together they read as a single ring that's solid blue at the inner
          edge and fades to nothing outward.
        */}
        {isHeld && (
          <>
            {/* Glow layer — thick, blurred, lower opacity */}
            <circle ref={rippleRingRef} cx="50%" cy="-100" r="7"
              fill="none" stroke="rgba(100,200,255,0.55)" strokeWidth="8" opacity="0"
              filter={`url(#rippleGlow-${tile.id})`}
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
            {/* Edge layer — thin, sharp, higher opacity */}
            <circle ref={rippleEdgeRef} cx="50%" cy="-100" r="7"
              fill="none" stroke="rgba(160,225,255,0.9)" strokeWidth="1" opacity="0"
            >
              <animate ref={rippleEdgeAnimRRef}
                attributeName="r" from="7" to="42"
                dur="0.45s" begin="indefinite" fill="freeze"
              />
              <animate ref={rippleEdgeAnimOpRef}
                attributeName="opacity" from="0.9" to="0"
                dur="0.45s" begin="indefinite" fill="freeze"
              />
            </circle>
          </>
        )}

        {/*
          ── Arc dot — transient beat-hit indicator ────────────────────────
          Invisible by default (r=0, opacity=0). On each beat hit, fireBeat()
          calls beginElement() on both <animate> children:
            r:       staticDotR → arcDotR → 0  (grows from static dot, then shrinks away)
            opacity: 0 → 1 → 0                 (flashes bright, then fades out)
          fill="freeze" holds the final value (r=0, opacity=0) between beats.
          cx/cy are updated each rAF frame so it's always at the dome apex.
        */}
        {isHeld && (
          <circle
            ref={arcDotRef}
            cx="50%"
            cy="-100"
            r="0"
            opacity="0"
            fill="rgba(160, 230, 255, 0.8)"
            filter={`url(#arcGlow-${tile.id})`}
          >
            {/* r: grow from static-dot size → larger (blur softens edges so we go bigger) → shrink to 0 */}
            <animate ref={arcDotAnimRRef}
              attributeName="r"
              values="3;12;12;0"
              keyTimes="0;0.2;0.65;1"
              dur="0.45s"
              begin="indefinite"
              fill="freeze"
            />
            <animate ref={arcDotAnimOpRef}
              attributeName="opacity"
              values="0.85;0.85;0"
              keyTimes="0;0.55;1"
              dur="0.45s"
              begin="indefinite"
              fill="freeze"
            />
          </circle>
        )}
      </svg>

      {/* Tap ring at the bottom — hidden once held or tapped */}
      {!isTapped && !isHeld && <div className="game-tile__hold-ring" />}
    </div>
  );
}, (prev, next) =>
  // Skip re-render unless a meaningful prop changed.
  // `style` is intentionally excluded — values are derived from immutable tile
  // properties and are structurally identical across renders for the same tile.
  // `tapped` removed — now managed as local state (isTapped) inside this component.
  prev.tile === next.tile &&
  prev.singleTileH === next.singleTileH &&
  prev.onTap === next.onTap &&
  prev.onRelease === next.onRelease &&
  prev.onNotePlay === next.onNotePlay
);
