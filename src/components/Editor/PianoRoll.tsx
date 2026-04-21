import React, { useState, useEffect, useRef } from 'react';
import { Stage, Layer, Rect, Text, Group, Line } from 'react-konva';

interface NoteData {
  id: string;
  pitch: number;
  start: number;
  duration: number;
  track?: string;
  trackIndex?: number;
  color?: string;
}

interface PianoRollProps {
  notes: NoteData[];
  bpm: number;
  snapResolution: number;
  folded?: boolean;
  rowHeight?: number;
  onNoteUpdate?: (updatedNote: NoteData) => void;
  onNoteDelete?: (id: string) => void;
  hoveredNoteId?: string | null;
  onHoverNote?: (id: string | null) => void;
  selectedNoteId?: string | null;
  onSelectNote?: (id: string | null) => void;
  isPitchLocked?: boolean;
}

const PIXELS_PER_BEAT = 150; 
const DEFAULT_rowHeight = 24;
const TOTAL_KEYS = 88; 
const KEYBOARD_WIDTH = 60;
const TIMELINE_HEIGHT = 40;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const PianoRoll: React.FC<PianoRollProps> = ({ 
  notes, bpm, snapResolution, folded = false, rowHeight = DEFAULT_rowHeight, 
  onNoteUpdate, onNoteDelete, hoveredNoteId, onHoverNote,
  selectedNoteId, onSelectNote, isPitchLocked = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [scroll, setScroll] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (containerRef.current) {
      const w = containerRef.current.offsetWidth;
      const h = containerRef.current.offsetHeight;
      setDimensions({ width: w, height: h });
      // Center initially on middle C (row 48)
      setScroll({ x: 0, y: -(48 * rowHeight) + h / 2 });
    }
    
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight
        });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const scrollXRef = useRef(0);
  const mainLayerRef = useRef<any>(null); // Grid + Notes combined
  const keyboardLayerRef = useRef<any>(null);
  const timelineLayerRef = useRef<any>(null);
  const timelineBgRef = useRef<any>(null);
  const activeKeysRef = useRef<Set<number>>(new Set());
  const lastTouchRef = useRef<{ x: number, y: number } | null>(null);

  // Auto-scroll when playing
  useEffect(() => {
    const handleUpdate = (e: any) => {
      const pTime = e.detail;
      const playheadX = pTime * PIXELS_PER_BEAT;

      if (pTime > 0) {
        // Keep playhead exactly at the left edge of the grid (flush with the Keyboard)
        const targetScrollX = -playheadX;
        
        // Update layer transforms natively
        if (mainLayerRef.current) mainLayerRef.current.x(targetScrollX + KEYBOARD_WIDTH);
        if (timelineLayerRef.current) timelineLayerRef.current.x(targetScrollX + KEYBOARD_WIDTH);
        if (timelineBgRef.current) timelineBgRef.current.x(-targetScrollX - KEYBOARD_WIDTH);
        
        // Sync our reference for wheel scrolling compatibility
        scrollXRef.current = targetScrollX;
      } else {
        // If pTime is 0 (Stop clicked), reset everything to origin
        scrollXRef.current = 0;
        
        if (mainLayerRef.current) mainLayerRef.current.x(KEYBOARD_WIDTH);
        if (timelineLayerRef.current) timelineLayerRef.current.x(KEYBOARD_WIDTH);
        if (timelineBgRef.current) timelineBgRef.current.x(-KEYBOARD_WIDTH);

        setScroll(prev => ({ ...prev, x: 0 }));
      }

      // ── Key Highlight Logic ───────────────────────────────────────────────
      // Find all notes crossing the playhead
      const activePitchesAtTime = notes
        .filter(n => pTime >= n.start && pTime < (n.start + n.duration))
        .map(n => n.pitch);
      
      const newActiveKeys = new Set(activePitchesAtTime);
      
      // Update only changed keys for maximum performace
      const keysToUpdate = new Set([...activeKeysRef.current, ...newActiveKeys]);
      
      if (keyboardLayerRef.current) {
        keysToUpdate.forEach(pitch => {
          if (activeKeysRef.current.has(pitch) !== newActiveKeys.has(pitch)) {
            const group = keyboardLayerRef.current.findOne(`.key-group-${pitch}`);
            if (group) {
              const rect = group.findOne('.key-rect');
              if (rect) {
                const isActive = newActiveKeys.has(pitch);
                const isBlack = [1, 3, 6, 8, 10].includes(pitch % 12);
                rect.fill(isActive ? '#38bdf8' : (isBlack ? '#000000' : '#f8fafc'));
              }
            }
          }
        });
      }
      activeKeysRef.current = newActiveKeys;
    };
    
    window.addEventListener('editor-playback-update', handleUpdate);
    return () => window.removeEventListener('editor-playback-update', handleUpdate);
  }, [dimensions.width, notes]);

  const handleTouchStart = (e: any) => {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (pos) {
      lastTouchRef.current = { ...pos };
    }
  };

  const handleTouchMove = (e: any) => {
    if (!lastTouchRef.current) return;
    
    // Prevent browser scrolling/bouncing
    if (e.evt) e.evt.preventDefault();

    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const dx = pos.x - lastTouchRef.current.x;
    const dy = pos.y - lastTouchRef.current.y;

    const newX = Math.min(0, scrollXRef.current + dx);
    const newY = Math.min(0, Math.max(-(TOTAL_KEYS * rowHeight) + dimensions.height - TIMELINE_HEIGHT, scroll.y + dy));

    scrollXRef.current = newX;
    setScroll(prev => ({
      x: newX,
      y: newY
    }));

    // native update for performance
    if (mainLayerRef.current) mainLayerRef.current.x(newX + KEYBOARD_WIDTH);
    if (timelineLayerRef.current) timelineLayerRef.current.x(newX + KEYBOARD_WIDTH);
    if (timelineBgRef.current) timelineBgRef.current.x(-newX - KEYBOARD_WIDTH);

    lastTouchRef.current = { ...pos };

    // Trigger audio scrub for touch
    window.dispatchEvent(new CustomEvent('editor-user-scrub', { detail: -newX / PIXELS_PER_BEAT }));
  };

  const handleTouchEnd = () => {
    lastTouchRef.current = null;
  };

  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const newX = Math.min(0, scrollXRef.current - e.evt.deltaX);
    scrollXRef.current = newX;
    
    setScroll(prev => ({
      x: newX,
      y: Math.min(0, Math.max(-(TOTAL_KEYS * rowHeight) + dimensions.height - TIMELINE_HEIGHT, prev.y - e.evt.deltaY))
    }));

    // Trigger scrub
    window.dispatchEvent(new CustomEvent('editor-user-scrub', { detail: -newX / PIXELS_PER_BEAT }));
  };

  // Determine which pitches are visible
  const visiblePitches = React.useMemo(() => {
    if (folded) {
      const unique = Array.from(new Set(notes.map(n => n.pitch))).sort((a,b) => b - a);
      return unique.length > 0 ? unique : [60, 59, 58]; // fallback if empty
    } else {
      const full = [];
      for (let p = 108; p >= 21; p--) full.push(p);
      return full;
    }
  }, [notes, folded]);

  const TOTAL_VISIBLE_ROWS = visiblePitches.length;

  const gridLines = [];
  const pianoKeys = [];
  const timelineTicks = [];
  
  const secPerBeat = 60 / bpm;
  const secPerSnap = secPerBeat * snapResolution;
  const maxTimeSeconds = Math.max(
    10, 
    Math.ceil(Math.max(...notes.map(n => n.start + n.duration), 0)) + 4
  );
  const snapLineCount = Math.ceil(maxTimeSeconds / secPerSnap);
  
  visiblePitches.forEach((midiPitch, i) => {
    const y = i * rowHeight;
    const keyInOctave = midiPitch % 12;
    const isBlackKey = [1, 3, 6, 8, 10].includes(keyInOctave); 
    const isCKey = keyInOctave === 0;
    const noteName = NOTE_NAMES[midiPitch % 12] + (Math.floor(midiPitch / 12) - 1);

    // Grid Row Background
    gridLines.push(
      <Rect
        key={`h-bg-${midiPitch}`}
        x={0}
        y={y}
        width={maxTimeSeconds * PIXELS_PER_BEAT}
        height={rowHeight}
        fill={isBlackKey ? '#0f172a' : 'rgba(30, 41, 59, 0.7)'}
      />
    );
    // Grid Row Line
    gridLines.push(
      <Line
        key={`h-${i}`}
        points={[0, y, maxTimeSeconds * PIXELS_PER_BEAT, y]}
        stroke="#0f172a"
        strokeWidth={1}
        opacity={midiPitch % 12 === 0 ? 0.8 : 0.3}
      />
    );

    // Keyboard Render
    pianoKeys.push(
      <Group key={`key-${midiPitch}`} y={y}>
        <Rect
          x={0}
          y={0}
          width={KEYBOARD_WIDTH}
          height={rowHeight}
          fill={isBlackKey ? '#000000' : '#f8fafc'}
          stroke="#1e293b"
          strokeWidth={1}
        />
        <Text
          text={`${noteName}${Math.floor(midiPitch / 12) - 1}`}
          x={KEYBOARD_WIDTH - 28}
          y={6}
          fill={isBlackKey ? '#94a3b8' : '#64748b'}
          fontSize={9}
          fontFamily="Inter"
          fontWeight={isCKey ? 700 : 500}
          align="right"
        />
      </Group>
    );
  });

  // Vertical Time grid & Timeline Ticks
  for (let i = 0; i <= snapLineCount; i++) {
    const t = i * secPerSnap;
    const x = t * PIXELS_PER_BEAT;
    
    // Using simple float bounds logic to identify beat vs snap
    const isBeatLine = i % Math.round(1 / snapResolution) === 0;
    const isBarLine = i % Math.round(4 / snapResolution) === 0;
    
    gridLines.push(
      <Line 
        key={`v-${i}`}
        points={[x, 0, x, TOTAL_KEYS * rowHeight]}
        stroke={isBarLine ? '#475569' : isBeatLine ? '#334155' : '#1e293b'}
        strokeWidth={isBarLine ? 2 : 1}
      />
    );

    // Draw timeline ticks for beats and bars
    if (isBeatLine) {
      timelineTicks.push(
        <Line key={`tick-beat-${i}`} points={[x, 22, x, TIMELINE_HEIGHT]} stroke="#475569" strokeWidth={isBarLine ? 2 : 1} />
      );
    }
    
    if (isBarLine) {
      const barNum = Math.floor(i / Math.round(4 / snapResolution)) + 1;
      timelineTicks.push(
        <Text key={`bar-${i}`} text={`BAR ${barNum}`} x={x + 4} y={24} fill="#cbd5e1" fontSize={10} fontFamily="Inter" fontWeight={700} />
      );
    }
  }

  // Draw Seconds Timeline (at the top now)
  const secondTicks = [];
  for (let s = 0; s <= maxTimeSeconds; s++) {
    const x = s * PIXELS_PER_BEAT;
    
    // Main second tick and text
    secondTicks.push(
      <Line key={`s-tick-${s}`} points={[x, 0, x, 14]} stroke="#475569" strokeWidth={1} />
    );
    secondTicks.push(
      <Text 
        key={`s-text-${s}`} 
        text={`${s}s`} 
        x={x + 4} 
        y={4} 
        fill="#94a3b8" 
        fontSize={9} 
        fontFamily="JetBrains Mono" 
      />
    );

    // Micro ticks (100ms) - don't draw for the very last second to avoid overflow
    if (s < maxTimeSeconds) {
      for (let ms = 1; ms < 10; ms++) {
        const msX = x + (ms * 0.1) * PIXELS_PER_BEAT;
        secondTicks.push(
          <Line key={`ms-tick-${s}-${ms}`} points={[msX, 0, msX, 6]} stroke="#334155" strokeWidth={1} opacity={0.6} />
        );
      }
    }
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      {dimensions.width > 0 && (
        <Stage 
          width={dimensions.width} 
          height={dimensions.height} 
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* 1. Main Content Layer (Scrollable Grid + Notes) */}
          <Layer ref={mainLayerRef} x={(scroll.x || scrollXRef.current) + KEYBOARD_WIDTH} y={scroll.y + TIMELINE_HEIGHT}>
            <Group>{gridLines}</Group>
            <Group>
              {notes.map(note => {
                const yIndex = visiblePitches.indexOf(note.pitch);
                if (yIndex === -1 && folded) return null;

                const noteColor = note.trackIndex === 1 ? '#10b981' : '#3b82f6';
                const noteWidth = note.duration * PIXELS_PER_BEAT;

                return (
                  <Group
                    key={note.id}
                    x={note.start * PIXELS_PER_BEAT}
                    y={yIndex * rowHeight}
                    draggable
                    onDragMove={(e) => {
                      const node = e.target;
                      const snapDistX = secPerSnap * PIXELS_PER_BEAT;
                      const snapX = Math.round(node.x() / snapDistX) * snapDistX;
                      const originalY = yIndex * rowHeight;
                      const snapY = isPitchLocked ? originalY : Math.round(node.y() / rowHeight) * rowHeight;
                      node.position({ x: snapX, y: snapY });
                    }}
                    onDragEnd={(e) => {
                      const node = e.target;
                      if (node === e.currentTarget) {
                        const newStart = node.x() / PIXELS_PER_BEAT;
                        const snapRow = Math.round(node.y() / rowHeight);
                        const clampedRow = Math.max(0, Math.min(TOTAL_VISIBLE_ROWS - 1, snapRow));
                        const newPitch = visiblePitches[clampedRow];
                        onNoteUpdate?.({ ...note, start: newStart, pitch: newPitch });
                      }
                    }}
                    onClick={() => onSelectNote?.(note.id)}
                    onDblClick={() => {
                      const newTrackIndex = note.trackIndex === 0 ? 1 : 0;
                      onNoteUpdate?.({ ...note, trackIndex: newTrackIndex });
                    }}
                    onContextMenu={(e) => {
                      e.evt.preventDefault();
                      onNoteDelete?.(note.id);
                    }}
                    onMouseEnter={() => {
                      onHoverNote?.(note.id);
                      const stage = containerRef.current?.querySelector('canvas');
                      if (stage) stage.style.cursor = 'pointer';
                    }}
                    onMouseLeave={() => {
                      onHoverNote?.(null);
                      const stage = containerRef.current?.querySelector('canvas');
                      if (stage) stage.style.cursor = 'default';
                    }}
                  >
                    <Rect
                      name="note-body"
                      width={Math.max(noteWidth - 1, 2)}
                      height={rowHeight - 4}
                      y={2}
                      fill={hexToRgba(noteColor, note.id === selectedNoteId || note.id === hoveredNoteId ? 0.7 : 0.4)}
                      stroke={note.id === selectedNoteId ? '#fbbf24' : (note.id === hoveredNoteId ? '#ffffff' : noteColor)}
                      strokeWidth={1}
                      cornerRadius={2}
                    />
                    <Rect
                      name="resize-handle"
                      x={noteWidth - 10}
                      y={2}
                      width={10}
                      height={rowHeight - 4}
                      fill="transparent"
                      draggable
                      onDragStart={(e) => { e.cancelBubble = true; }}
                      onDragMove={(e) => {
                        e.cancelBubble = true;
                        const handle = e.target;
                        const group = handle.getParent();
                        const body = group.findOne('.note-body');
                        const snapDistX = secPerSnap * PIXELS_PER_BEAT;
                        const rawWidth = handle.x() + 10;
                        const snappedWidth = Math.max(snapDistX, Math.round(rawWidth / snapDistX) * snapDistX);
                        body.width(snappedWidth - 1);
                        handle.x(snappedWidth - 10);
                        handle.y(2);
                      }}
                      onDragEnd={(e) => {
                        e.cancelBubble = true;
                        const handle = e.target;
                        const newDuration = (handle.x() + 10) / PIXELS_PER_BEAT;
                        onNoteUpdate?.({ ...note, duration: newDuration });
                      }}
                      onMouseEnter={(e) => {
                        const stage = e.target.getStage();
                        stage.container().style.cursor = 'ew-resize';
                      }}
                      onMouseLeave={(e) => {
                        const stage = e.target.getStage();
                        stage.container().style.cursor = 'default';
                      }}
                    />
                  </Group>
                );
              })}
            </Group>
          </Layer>

          {/* 3. Sticky Left Sidebar Keyboard */}
          <Layer ref={keyboardLayerRef} x={0} y={scroll.y + TIMELINE_HEIGHT}>
            {/* Opaque background to hide scrolling notes */}
            <Rect 
              x={0} 
              y={0} 
              width={KEYBOARD_WIDTH} 
              height={TOTAL_VISIBLE_ROWS * rowHeight} 
              fill="#0f172a" 
            />
            {visiblePitches.map((midiPitch, i) => {
              const y = i * rowHeight;
              const keyInOctave = midiPitch % 12;
              const isBlackKey = [1, 3, 6, 8, 10].includes(keyInOctave); 
              const noteName = NOTE_NAMES[midiPitch % 12] + (Math.floor(midiPitch / 12) - 1);

              return (
                <Group key={`key-${midiPitch}`} y={y} name={`key-group-${midiPitch}`}>
                  <Rect
                    name="key-rect"
                    width={KEYBOARD_WIDTH}
                    height={rowHeight - 1}
                    fill={isBlackKey ? '#000000' : '#f8fafc'}
                    stroke="#1e293b"
                    strokeWidth={1}
                  />
                  <Text
                    text={noteName}
                    x={KEYBOARD_WIDTH - 28}
                    y={6}
                    fill={isBlackKey ? '#94a3b8' : '#64748b'}
                    fontSize={9}
                    fontFamily="Inter"
                    fontWeight={midiPitch % 12 === 0 ? 700 : 500}
                    align="right"
                  />
                </Group>
              );
            })}
            <Line 
              points={[KEYBOARD_WIDTH, 0, KEYBOARD_WIDTH, TOTAL_VISIBLE_ROWS * rowHeight]} 
              stroke="#0f172a" 
              strokeWidth={2} 
            />
          </Layer>

          {/* Sticky Top Timeline Header */}
          <Layer 
            ref={timelineLayerRef} 
            x={(scroll.x || scrollXRef.current) + KEYBOARD_WIDTH} 
            y={0}
          >
            {/* Obscure background */}
            <Rect 
              ref={timelineBgRef} 
              x={-(scroll.x || scrollXRef.current) - KEYBOARD_WIDTH} 
              y={0} 
              width={dimensions.width} 
              height={TIMELINE_HEIGHT} 
              fill="#0f172a" 
            />
            <Rect x={0} y={0} width={maxTimeSeconds * PIXELS_PER_BEAT} height={TIMELINE_HEIGHT} fill="#1e293b" />
            
            {/* Timeline markings */}
            {timelineTicks}
            {secondTicks}
          </Layer>

          {/* 4. Static UI Layer (Corner Piece + Playhead) */}
          <Layer x={0} y={0} listening={false}>
            {/* Top-Left Corner Piece */}
            <Rect width={KEYBOARD_WIDTH} height={TIMELINE_HEIGHT} fill="#0f172a" />
            <Line points={[KEYBOARD_WIDTH, 0, KEYBOARD_WIDTH, TIMELINE_HEIGHT]} stroke="#1e293b" strokeWidth={1} />
            <Line points={[0, TIMELINE_HEIGHT, KEYBOARD_WIDTH, TIMELINE_HEIGHT]} stroke="#1e293b" strokeWidth={1} />
            
            {/* Playhead reticle */}
            <Group x={KEYBOARD_WIDTH}>
              <Rect x={-3} y={0} width={6} height={TIMELINE_HEIGHT} fill="#ef4444" cornerRadius={2} />
              <Line points={[0, TIMELINE_HEIGHT, 0, dimensions.height]} stroke="#dc2626" strokeWidth={2} opacity={0.8} />
            </Group>
          </Layer>
        </Stage>
      )}
    </div>
  );
};
