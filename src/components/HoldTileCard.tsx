/**
 * HoldTileCard — SVG-based hold progress UI
 *
 * Uses a single SVG <path> for the fill rectangle + dome cap.
 * All per-frame updates go through WAAPI — no rAF.
 *
 * Geometry:
 *   Fill shape: M 0 H → L W H → L W fillTopY → A domeR domeR 0 0 0 0 fillTopY → Z
 *   domeR = tileWidth (shallow dome, sagitta ≈ 0.134 × W).
 *   Arc sweeps counter-clockwise (sweep-flag 0), apex at the arc dot center.
 */

import { useRef, useEffect, useMemo, memo } from 'react';
import type { Tile } from '../types/track';
import type { ParsedNote } from '../types/midi';

interface Props {
  tile: Tile;
  onTap: (tile: Tile) => void;
  onRelease?: () => void;
  onNotePlay?: (notes: ParsedNote[]) => void;
  style?: React.CSSProperties;
  className?: string;
  /** Height of a single slot in px (MIN_HEIGHT × scaleRatio). */
  singleTileH?: number;
  /** Playback speed multiplier — scales beat animation duration. Defaults to 1. */
  speed?: number;
  /** If set, automatically starts the hold animation on mount with this fromBottom value. */
  autoPlay?: number;
}

// How many px above the anchor the arc dot center sits
const DOT_OFFSET_PX = 50;

function HoldTileCardImpl({ tile, onTap, onRelease, onNotePlay, style, className = '', singleTileH = 100, speed = 1, autoPlay }: Props) {
  // ── DOM refs ─────────────────────────────────────────────────────────────
  const divRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const fillPathRef = useRef<SVGPathElement>(null);
  const arcDotRef = useRef<SVGCircleElement>(null);
  const rippleRingRef = useRef<SVGCircleElement>(null);
  const rippleEdgeRef = useRef<SVGCircleElement>(null);
  const dotsSvgRef = useRef<SVGSVGElement>(null);
  const tapDebugDotRef = useRef<HTMLDivElement>(null);

  // ── Motion refs (no re-render) ────────────────────────────────────────────
  const tapYFromBottomRef = useRef(0);
  const isTappedRef = useRef(false);
  const isHeldRef = useRef(false);
  const arcDotRRef = useRef(7);
  const cachedWRef = useRef(0);
  const cachedHRef = useRef(0);
  const startTimeRef = useRef(0);
  const totalDurationSRef = useRef(1);
  const scheduledAnimsRef = useRef<Animation[]>([]);
  const audioTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const fillGroupRef = useRef<SVGSVGElement>(null);
  const arcRippleGroupRef = useRef<SVGSVGElement>(null);
  const fillAnimRef = useRef<Animation | null>(null);
  const arcRippleAnimRef = useRef<Animation | null>(null);

  const onNotePlayRef = useRef(onNotePlay);
  useEffect(() => { onNotePlayRef.current = onNotePlay; }, [onNotePlay]);

  // ── Beat data ────────────────────────────────────────────────────────────
  const primaryNote = tile.notes[0];

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
      .map(g => ({ ...g, slotOffset: g.slotStart - primaryNote.slotStart }));
  }, [tile.notes, primaryNote.slotStart]);

  // ── Core hold logic ───────────────────────────────────────────────────────
  const startHold = (W: number, H: number, fromBottom: number) => {
    fromBottom = Math.max(0, Math.min(H, fromBottom));
    tapYFromBottomRef.current = fromBottom;
    cachedWRef.current = W;
    cachedHRef.current = H;
    arcDotRRef.current = Math.min(10, Math.round(W * 0.06));
    startTimeRef.current = performance.now();
    totalDurationSRef.current = primaryNote.duration / speed;
    isHeldRef.current = true;
    divRef.current?.classList.add('game-tile--hold-active');

    if (arcDotRef.current) {
      arcDotRef.current.setAttribute('r', '0');
      arcDotRef.current.setAttribute('opacity', '0');
    }

    fillAnimRef.current?.cancel();
    arcRippleAnimRef.current?.cancel();

    const translateStart = H - fromBottom - DOT_OFFSET_PX;
    const translateEnd = -DOT_OFFSET_PX;

    // Synchronously place both groups at translateStart so there is no 1-frame
    // flash at translateY(100%) between cancel() and WAAPI's first compositor frame.
    const startTransform = `translateY(${translateStart}px)`;
    if (fillGroupRef.current)       fillGroupRef.current.style.transform       = startTransform;
    if (arcRippleGroupRef.current)  arcRippleGroupRef.current.style.transform  = startTransform;

    // scroll speed = full tile height / full hold duration  (px/s, matches game scroll rate)
    const scrollSpeedPxPerS = H / totalDurationSRef.current;
    // time = distance / speed
    const fillDistance = translateStart - translateEnd;          // = H - fromBottom
    const arcDistance  = translateStart;                         // arc stops at translateY(0)
    const fillDurationMs       = (fillDistance / scrollSpeedPxPerS) * 1000;
    const arcRippleDurationMs  = translateStart > 0 ? (arcDistance / scrollSpeedPxPerS) * 1000 : 0;

    const tapTime = performance.now();

    fillAnimRef.current = fillGroupRef.current?.animate(
      [{ transform: startTransform }, { transform: `translateY(${translateEnd}px)` }],
      { duration: fillDurationMs, fill: 'forwards', easing: 'linear' }
    ) ?? null;

    if (arcRippleGroupRef.current && arcRippleDurationMs > 0) {
      arcRippleAnimRef.current = arcRippleGroupRef.current.animate(
        [{ transform: startTransform }, { transform: 'translateY(0px)' }],
        { duration: arcRippleDurationMs, fill: 'forwards', easing: 'linear' }
      );
    } else {
      if (arcRippleGroupRef.current)
        arcRippleGroupRef.current.style.transform = 'translateY(0px)';
      arcRippleAnimRef.current = null;
    }

    // One-shot rAF: seek both animations forward by the actual elapsed time since the
    // tap event fired, so they align with the scroll WAAPI which has been running continuously.
    const fillAnim = fillAnimRef.current;
    const arcAnim  = arcRippleAnimRef.current;
    requestAnimationFrame(() => {
      const elapsed = performance.now() - tapTime;
      if (fillAnim && fillAnim.playState !== 'finished') fillAnim.currentTime = elapsed;
      if (arcAnim  && arcAnim.playState  !== 'finished') arcAnim.currentTime  = elapsed;
      console.log(`elapsed = ${elapsed.toFixed(2)}ms`)
    });

    // Pre-schedule WAAPI burst animations + setTimeout audio callbacks.
    scheduledAnimsRef.current.forEach(a => a.cancel());
    scheduledAnimsRef.current = [];
    audioTimeoutsRef.current.forEach(clearTimeout);
    audioTimeoutsRef.current = [];

    const arcR = arcDotRRef.current;
    const staticR = Math.round(W * 0.03);
    const fromR = Math.round(arcR * 3);
    const toR = Math.round(W * 0.3);
    const durMs = (0.2 / speed) * 1000;

    for (const beat of secondaryBeats) {
      const delayMs = ((beat.time - primaryNote.time) / speed) * 1000;

      if (arcDotRef.current) {
        scheduledAnimsRef.current.push(arcDotRef.current.animate([
          { r: `${staticR}px`, opacity: '0.85',  offset: 0    },
          { r: `${arcR}px`,   opacity: '0.85',  offset: 0.2  },
          { r: `${arcR}px`,   opacity: '0.85',  offset: 0.65 },
          { r: '0px',         opacity: '0',     offset: 1    },
        ], { delay: delayMs, duration: durMs, fill: 'forwards' }));
      }
      if (rippleRingRef.current) {
        scheduledAnimsRef.current.push(rippleRingRef.current.animate([
          { r: `${fromR}px`, opacity: '1', offset: 0 },
          { r: `${toR}px`,   opacity: '0', offset: 1 },
        ], { delay: delayMs, duration: durMs, fill: 'forwards' }));
      }
      if (rippleEdgeRef.current) {
        scheduledAnimsRef.current.push(rippleEdgeRef.current.animate([
          { r: `${fromR}px`, opacity: '0.9', offset: 0 },
          { r: `${toR}px`,   opacity: '0',   offset: 1 },
        ], { delay: delayMs, duration: durMs, fill: 'forwards' }));
      }

      // Audio callback via setTimeout — same delay as WAAPI burst.
      audioTimeoutsRef.current.push(
        setTimeout(() => onNotePlayRef.current?.(beat.notes), delayMs)
      );
    }

    // Position dots via direct DOM + reveal via WAAPI (no React re-render).
    if (dotsSvgRef.current) {
      const circles = dotsSvgRef.current.querySelectorAll('circle');
      const dotR = Math.round(W * 0.03);
      secondaryBeats.forEach((beat, idx) => {
        const el = circles[idx] as SVGCircleElement | undefined;
        if (!el) return;
        const dotPxFromBottom = fromBottom + beat.slotOffset * singleTileH;
        el.setAttribute('r', dotPxFromBottom > H ? '0' : String(dotR));
        el.setAttribute('cy', String(H - dotPxFromBottom - DOT_OFFSET_PX));
      });
      dotsSvgRef.current.getAnimations().forEach(a => a.cancel());
      dotsSvgRef.current.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 80, fill: 'forwards' }
      );
    }

    isTappedRef.current = true;
    divRef.current?.classList.add('game-tile--tapped');
    if (ringRef.current) ringRef.current.style.display = 'none';
    if (tapDebugDotRef.current) {
      tapDebugDotRef.current.style.top = `${H - fromBottom}px`;
      tapDebugDotRef.current.style.display = 'block';
    }
    onTap(tile);
  };

  // ── Mount: pre-compute fill path + optional autoPlay ─────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!divRef.current) return;
    const W = divRef.current.clientWidth;
    const H = divRef.current.clientHeight;
    if (fillPathRef.current) {
      const sagitta = Math.round(W - Math.sqrt(W * W - (W * W) / 4));
      const H_large = H + DOT_OFFSET_PX;
      fillPathRef.current.setAttribute('d',
        `M 0 ${H_large} L ${W} ${H_large} L ${W} ${sagitta} A ${W} ${W} 0 0 0 0 ${sagitta} Z`
      );
    }
    if (autoPlay != null) startHold(W, H, autoPlay);
  }, []);

  // ── Pointer handlers ─────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isTappedRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const W = e.currentTarget.clientWidth;
    const H = e.currentTarget.clientHeight;
    console.log("Pointer down at offsetY =", e.nativeEvent.offsetY, "from bottom =", H - e.nativeEvent.offsetY);
    startHold(W, H, H - e.nativeEvent.offsetY);
  };

  const handleRelease = () => {
    isHeldRef.current = false;
    audioTimeoutsRef.current.forEach(clearTimeout);
    audioTimeoutsRef.current = [];
    scheduledAnimsRef.current.forEach(a => a.cancel());
    scheduledAnimsRef.current = [];

    const H = cachedHRef.current;
    const elapsed = (performance.now() - startTimeRef.current) / 1000;
    const reachedPercent = (tapYFromBottomRef.current / H) * 100
      + (elapsed / totalDurationSRef.current) * 100;

    if (fillGroupRef.current && fillAnimRef.current) {
      fillAnimRef.current.commitStyles();
      fillAnimRef.current.cancel();
      fillAnimRef.current = null;

      const remainingPx = (100 - reachedPercent) / 100 * H;
      if (remainingPx <= 20) {
        fillGroupRef.current.style.transform = `translateY(${-DOT_OFFSET_PX}px)`;
      }
    }

    arcRippleAnimRef.current?.cancel();
    arcRippleAnimRef.current = null;

    if (dotsSvgRef.current) {
      dotsSvgRef.current.getAnimations().forEach(a => a.cancel());
      dotsSvgRef.current.style.opacity = '0';
    }
    divRef.current?.classList.remove('game-tile--hold-active');
    onRelease?.();
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={divRef}
      className={`game-tile game-tile--hold ${className}`}
      data-tile-id={tile.id}
      style={{ ...style, overflow: 'visible', background: `linear-gradient(to top, #000000 ${singleTileH * 0.4}px, #0e3a6e ${singleTileH}px, #1565c0 100%)` }}
      onPointerDown={handlePointerDown}
      onPointerUp={handleRelease}
      onPointerCancel={handleRelease}
    >
      <div className="game-tile__hold-glow" style={{ pointerEvents: 'none' }} />
      <div className="game-tile__hold-line" style={{ pointerEvents: 'none' }} />

      {/* Fill path — clipped to tile bounds */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 3 }}>
        <svg
          ref={fillGroupRef}
          style={{ position: 'absolute', inset: 0, overflow: 'visible', transform: 'translateY(100%)', pointerEvents: 'none' }}
          width="100%" height="100%"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={`fillGrad-${tile.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="rgba(70, 170, 235, 1.0)" />
              <stop offset="8%"   stopColor="rgba(55, 150, 225, 0.99)" />
              <stop offset="35%"  stopColor="#308af1" />
              <stop offset="100%" stopColor="#1a6bc8" />
            </linearGradient>
          </defs>
          <path ref={fillPathRef} d="" fill={`url(#fillGrad-${tile.id})`} />
        </svg>
      </div>

      {/* Arc dot + ripple — no clip, can overflow tile bounds */}
      <svg
        ref={arcRippleGroupRef}
        style={{ position: 'absolute', inset: 0, overflow: 'visible', transform: 'translateY(100%)', pointerEvents: 'none', zIndex: 4 }}
        width="100%" height="100%"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id={`arcGlow-${tile.id}`} x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="0.5" />
          </filter>
          <filter id={`rippleGlow-${tile.id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
          </filter>
        </defs>
        <circle ref={rippleRingRef} cx="50%" cy="0" r="7"
          fill="none" stroke="rgba(100,200,255,0.55)" strokeWidth="8" opacity="0"
          filter={`url(#rippleGlow-${tile.id})`}
        />
        <circle ref={rippleEdgeRef} cx="50%" cy="0" r="7"
          fill="none" stroke="rgba(160,225,255,0.9)" strokeWidth="1" opacity="0"
        />
        <circle ref={arcDotRef} cx="50%" cy="0" r="0" opacity="0"
          fill="rgba(160, 230, 255, 0.8)" filter={`url(#arcGlow-${tile.id})`}
        />
      </svg>

      {/* Dots SVG — always in DOM, hidden until startHold positions + reveals via WAAPI */}
      <svg
        ref={dotsSvgRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2, overflow: 'hidden', opacity: 0 }}
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
      >
        {secondaryBeats.map((beat, idx) => {
          const approxTileH = tile.rowSpan * singleTileH;
          const approxCy = approxTileH - beat.slotOffset * singleTileH - DOT_OFFSET_PX;
          const approxR = Math.max(2, Math.round(singleTileH * 0.03));
          return <circle key={idx} cx="50%" cy={approxCy} r={approxR} fill="rgba(120,220,255,0.9)" />;
        })}
      </svg>

      <div ref={ringRef} className="game-tile__hold-ring" style={{ pointerEvents: 'none' }} />
      <div ref={tapDebugDotRef} style={{
        display: 'none', position: 'absolute', left: '50%', transform: 'translate(-50%, -50%)',
        width: 10, height: 10, borderRadius: '50%', background: 'red',
        pointerEvents: 'none', zIndex: 10,
      }} />
    </div>
  );
}

export const HoldTileCard = memo(HoldTileCardImpl, (prev: Props, next: Props) =>
  prev.tile === next.tile &&
  prev.singleTileH === next.singleTileH &&
  prev.speed === next.speed &&
  prev.autoPlay === next.autoPlay &&
  prev.onTap === next.onTap &&
  prev.onRelease === next.onRelease &&
  prev.onNotePlay === next.onNotePlay
);
