import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { MidiParseResult } from '../types/midi';
import type { Tile } from '../types/track';
import { useGameBoard } from '../hooks/useGameBoard';
import { MIN_HEIGHT } from '../utils/tileBuilder';
import { buildTrackFromTiles } from '../utils/trackBuilder';

interface Props {
    result: MidiParseResult;
    onPlayNote: (tile: Tile) => void;
    onHoldRelease?: () => void;
    onExit?: () => void;
}

const LANE_COUNT = 4;

export function CanvasGameBoard({ result, onPlayNote, onExit }: Props) {
    const { tappedIds, tapTile } = useGameBoard(onPlayNote);
    const [started, setStarted] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [viewport, setViewport] = useState({ w: 0, h: 0 });
    const startTimeRef = useRef<number | null>(null);

    const { tiles, info } = result;

    const trackData = useMemo(() => buildTrackFromTiles(tiles), [tiles]);

    // Measure container using ResizeObserver
    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver((entries) => {
            for (const en of entries) {
                setViewport({ w: en.contentRect.width, h: en.contentRect.height });
            }
        });
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    const viewportH = viewport.h;
    const viewportW = viewport.w;
    const scaleRatio = viewportH > 0 ? (viewportH / 4) / MIN_HEIGHT : 1;

    const effectiveBpm = info.effectiveBpm ?? info.bpm;
    const slotDurationS = 60 / effectiveBpm;
    const pixelsPerSecond = (MIN_HEIGHT / slotDurationS) * scaleRatio;

    const scrollSegments = useMemo(() => {
        return info.scrollSegments?.map(s => ({
            ...s,
            startPixel: s.startPixel * scaleRatio,
            endPixel: s.endPixel * scaleRatio,
        }));
    }, [info.scrollSegments, scaleRatio]);

    const timeToPixels = useCallback((t: number) => {
        if (!scrollSegments || scrollSegments.length === 0) return t * pixelsPerSecond;
        for (const seg of scrollSegments) {
            if (t >= seg.startTime && t <= seg.endTime) {
                const segDuration = seg.endTime - seg.startTime;
                const segHeight = seg.endPixel - seg.startPixel;
                const progress = segDuration === 0 ? 0 : (t - seg.startTime) / segDuration;
                return seg.startPixel + (progress * segHeight);
            }
        }
        const last = scrollSegments[scrollSegments.length - 1];
        const lastSpeed = (last.endTime - last.startTime) === 0 ? pixelsPerSecond : (last.endPixel - last.startPixel) / (last.endTime - last.startTime);
        return last.endPixel + (t - last.endTime) * lastSpeed;
    }, [scrollSegments, pixelsPerSecond]);


    // Flatten trackData into simple renderable rectangles
    const renderList = useMemo(() => {
        const list: any[] = [];
        let currentY = 0; // starts at bottom = 0
        for (const card of trackData.cards) {
            const h = card.span * MIN_HEIGHT * scaleRatio;
            if (card.type === 'START') {
                list.push({ type: 'START', y: currentY, h, lane: 0 }); // lane 0 for now
            } else if (card.type === 'TILE') {
                for (const t of card.tiles) {
                    const tileH = t.rowSpan * MIN_HEIGHT * scaleRatio;
                    const tileY = currentY + (t.rowStart * MIN_HEIGHT * scaleRatio);
                    list.push({ type: 'TILE', tile: t, y: tileY, h: tileH, lane: t.lane, id: t.id });
                }
            }
            currentY += h;
        }
        return list;
    }, [trackData, scaleRatio]);

    const yOffsetRef = useRef(0);
    const tappedIdsRef = useRef(tappedIds);
    tappedIdsRef.current = tappedIds;

    // Render Loop
    useEffect(() => {
        if (viewportH === 0 || viewportW === 0) return;

        let raf: number;
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx) return;

        const draw = (timestamp: number) => {
            // If not started, offset is 0
            let targetPxFromBottom = 0;
            if (started) {
                if (startTimeRef.current === null) startTimeRef.current = timestamp;
                const elapsed = (timestamp - startTimeRef.current) / 1000;
                targetPxFromBottom = timeToPixels(elapsed);
            } else {
                startTimeRef.current = null;
            }

            yOffsetRef.current = targetPxFromBottom;

            // Clear Background
            ctx.fillStyle = '#333';
            ctx.fillRect(0, 0, viewport.w, viewport.h);

            const laneW = viewport.w / LANE_COUNT;

            // Draw Grid Lines
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 1; i < LANE_COUNT; i++) {
                ctx.moveTo(i * laneW, 0);
                ctx.lineTo(i * laneW, viewport.h);
            }
            ctx.stroke();

            // Draw Tiles
            for (const item of renderList) {
                // item.y is the bottom coordinate from the start line
                const bottomDist = item.y - targetPxFromBottom;
                const screenY = viewportH - bottomDist - item.h;

                // Camera Frustum Culling
                if (screenY > viewportH || screenY + item.h < 0) continue;

                if (item.type === 'START') {
                    ctx.fillStyle = '#ffaa00';
                    ctx.fillRect(item.lane * laneW, screenY, laneW, item.h);
                    ctx.fillStyle = '#fff';
                    ctx.font = '24px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText("START", item.lane * laneW + laneW / 2, screenY + item.h / 2);
                } else if (item.type === 'TILE') {
                    const isTapped = tappedIdsRef.current.has(item.id);
                    const isHold = item.tile.type === 'HOLD';

                    // Base fill
                    ctx.fillStyle = isTapped ? (isHold ? '#2a8bce' : '#555') : (isHold ? '#59b2f4' : '#111');
                    ctx.fillRect(item.lane * laneW, screenY, laneW, item.h);

                    // Outline
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(item.lane * laneW, screenY, laneW, item.h);
                }
            }

            raf = requestAnimationFrame(draw);
        };

        raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, [started, viewport, renderList, timeToPixels]);


    const handlePointerDown = (e: React.PointerEvent) => {
        // If not started, just start the game on the first tap anywhere for now
        if (!started) {
            setStarted(true);
            return;
        }

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const laneW = viewport.w / LANE_COUNT;
        const lane = Math.floor(x / laneW);

        // Map screen coordinate to Track coordinate
        const trackY = (viewportH - y) + yOffsetRef.current;

        // Check intersection backwards (topmost tiles first if they overlap)
        for (let i = renderList.length - 1; i >= 0; i--) {
            const item = renderList[i];
            if (item.type === 'TILE' && item.lane === lane) {
                if (trackY >= item.y && trackY <= item.y + item.h) {
                    tapTile(item.tile);
                    break;
                }
            }
        }
    };

    return (
        <div style={{ position: 'relative', height: '100%', width: '100%', background: '#333' }}>
            {/* Top HUD */}
            <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000,
                pointerEvents: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center',
                padding: '24px 16px',
            }}>
                <button
                    onClick={onExit}
                    style={{
                        position: 'absolute', left: 16, top: 24,
                        background: 'none', border: 'none', cursor: 'pointer', pointerEvents: 'auto',
                        opacity: started ? 0.6 : 1, transition: 'opacity 0.3s',
                        color: '#fff'
                    }}
                >
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                </button>
                <div style={{
                    fontSize: '48px', fontWeight: 'bold', color: '#ff4b4b',
                    WebkitTextStroke: '1.5px #fff', textShadow: '0px 2px 4px rgba(0,0,0,0.5)',
                }}>
                    {tappedIds.size}
                </div>
            </div>

            {/* Canvas Viewport */}
            <div
                ref={containerRef}
                style={{ width: '100%', height: '100%', overflow: 'hidden', touchAction: 'none' }}
                onPointerDown={handlePointerDown}
                onContextMenu={e => e.preventDefault()}
            >
                <canvas
                    ref={canvasRef}
                    width={viewportW}
                    height={viewportH}
                    style={{ display: 'block' }}
                />
            </div>
        </div>
    );
}
