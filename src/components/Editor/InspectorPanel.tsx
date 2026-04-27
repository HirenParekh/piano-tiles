import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Drawer, Box, Typography, Tabs, Tab, IconButton,
  Button, Divider, Stack, Tooltip, TextField
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CodeIcon from '@mui/icons-material/Code';
import ViewQuiltIcon from '@mui/icons-material/ViewQuilt';
import { NoteData } from '../../types/midi';
import { generateProductionJson } from '../../utils/pianoTilesExporter';
import { buildTilesFromNotes, MIN_HEIGHT } from '../../utils/tileBuilderStable';
import { ParsedNote } from '../../types/midi';
// import { buildTrackFromTiles } from '../../archive/css-board/trackBuilder';
// import { GameTileCard } from '../../archive/css-board/GameTileCard';
// import { HoldTileCard } from '../../archive/css-board/HoldTileCard';
// import { DoubleTileCard } from '../../archive/css-board/DoubleTileCard';
// import type { Tile } from '../../types/track';
// import { PhaserGameBoard } from '../PhaserGameBoard';
import { MidiParseResult } from '../../types/midi';

const midiToNoteName = (midi: number) => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const name = names[midi % 12];
  return `${name}${octave}`;
};

interface InspectorPanelProps {
  open: boolean;
  onClose: () => void;
  notes: NoteData[];
  bpm: number;
  baseBeats: number;
  playNote: (note: ParsedNote) => void;
  attackNote: (note: ParsedNote) => void;
  releaseNote: (note: ParsedNote) => void;
  hoveredNoteId?: string | null;
  onHoverNote?: (id: string | null) => void;
  selectedNoteId?: string | null;
  onSelectNote?: (id: string | null) => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  open, onClose, notes, bpm, baseBeats,
  playNote, attackNote: _, releaseNote: __,
  hoveredNoteId, onHoverNote,
  selectedNoteId, onSelectNote
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isInternalScrollRef = useRef(false);

  // Constants for Mapping
  const slotDurationS = baseBeats * (60 / bpm);
  const pixelsPerSecond = MIN_HEIGHT / slotDurationS;

  const midResult = useMemo<MidiParseResult | null>(() => {
    if (!open || activeTab !== 1 || notes.length === 0) return null;

    const slotDurationS = baseBeats * (60 / bpm);
    const rawParsedNotes: ParsedNote[] = notes.map(n => ({
      id: n.id, // CRITICAL: Map the original ID for selection sync
      midi: n.pitch,
      name: midiToNoteName(n.pitch),
      time: n.start,
      duration: n.duration,
      velocity: 0.7,
      trackIndex: n.trackIndex ?? 0,
      trackName: "track",
      channel: 0,
      // Round to 3 decimals to avoid precision ghosting
      slotStart: Math.round((n.start / slotDurationS) * 1000) / 1000,
      slotSpan: Math.round((n.duration / slotDurationS) * 1000) / 1000
    }));

    // Double Detection Pre-pass
    const startTimes: Record<string, number> = {};
    rawParsedNotes.forEach(n => {
      const key = n.slotStart.toFixed(3);
      startTimes[key] = (startTimes[key] || 0) + 1;
    });

    const parsedNotes = rawParsedNotes.map(n => {
      const key = n.slotStart.toFixed(3);
      if (startTimes[key] > 1) {
        return { ...n, tileType: 'DOUBLE' as const };
      }
      return n;
    });

    const tileNotes = parsedNotes.filter(n => n.trackIndex <= 1).sort((a, b) => a.slotStart - b.slotStart);

    try {
      const layout = buildTilesFromNotes(tileNotes);
      return {
        info: {
          name: "Inspector Preview",
          durationSeconds: notes.length > 0 ? notes[notes.length - 1].start + 2 : 0,
          bpm: bpm,
          effectiveBpm: bpm / baseBeats,
          timeSignature: [4, 4],
          trackCount: 1,
          totalNotes: notes.length
        },
        notes: parsedNotes,
        tiles: layout.tiles,
        totalHeight: layout.totalHeight
      };
    } catch (e) {
      console.error("Layout failed", e);
      return null;
    }
  }, [open, activeTab, notes, bpm, baseBeats]);

  useEffect(() => {
    const handleUpdate = (e: any) => {
      const pTime = e.detail;
      if (scrollRef.current && !isInternalScrollRef.current) {
        const viewportH = scrollRef.current.offsetHeight;
        const totalH = midResult?.totalHeight || 0;
        // The "Playhead" is at the bottom of the viewport
        // We have 300px padding at the top (End) and bottom (Start)
        // Y = TopPadding(300) + (totalHeight - (pTime * pps))
        const yPosInContent = 300 + (totalH - (pTime * pixelsPerSecond));
        scrollRef.current.scrollTop = yPosInContent - viewportH;
      }
    };

    window.addEventListener('editor-playback-update', handleUpdate);
    window.addEventListener('editor-user-scrub', handleUpdate);
    return () => {
      window.removeEventListener('editor-playback-update', handleUpdate);
      window.removeEventListener('editor-user-scrub', handleUpdate);
    };
  }, [midResult, pixelsPerSecond]);

  // Auto-Focus Selection Scroll
  useEffect(() => {
    if (selectedNoteId && midResult && scrollRef.current && activeTab === 1) {
      const selectedTile = midResult.tiles.find(t => t.id === selectedNoteId);
      if (selectedTile) {
        const viewportH = scrollRef.current.offsetHeight;
        // const _totalH = midResult.totalHeight;

        // Target: Center the tile at the playhead (bottom of viewport)
        // Y_in_content = 300 + selectedTile.top + selectedTile.height/2
        // To put this at bottom: st = Y_in_content - viewportH
        const yPosInContent = 300 + selectedTile.top + selectedTile.height / 2;

        scrollRef.current.scrollTo({
          top: yPosInContent - (viewportH * 0.9), // Slightly above bottom for better visibility
          behavior: 'smooth'
        });
      }
    }
  }, [selectedNoteId, midResult, activeTab]);

  const handleManualScroll = () => {
    if (scrollRef.current && activeTab === 1) {
      isInternalScrollRef.current = true;
      const viewportH = scrollRef.current.offsetHeight;
      const st = scrollRef.current.scrollTop;
      const totalH = midResult?.totalHeight || 0;

      // Calculate time based on bottom playhead position
      // st = (300 + totalH - (pTime * pps)) - viewportH
      // st + viewportH - 300 = totalH - (pTime * pps)
      // pTime * pps = totalH - (st + viewportH - 300)
      const pTime = (totalH - (st + viewportH - 300)) / pixelsPerSecond;

      window.dispatchEvent(new CustomEvent('editor-user-scrub', { detail: Math.max(0, pTime) }));

      // Reset after a short delay to allow sync to catch up
      setTimeout(() => { isInternalScrollRef.current = false; }, 50);
    }
  };

  const [startBar, setStartBar] = useState<number>(1);
  const [endBar, setEndBar] = useState<number | ''>('');

  // Lazy compute the JSON only when panel is open and JSON tab is active
  const exportResult = useMemo(() => {
    if (!open || activeTab !== 0) return { json: '', metadata: {} };
    return generateProductionJson(notes, bpm, baseBeats, startBar, endBar === '' ? undefined : endBar);
  }, [open, activeTab, notes, bpm, baseBeats, startBar, endBar]);

  const productionJson = exportResult.json;
  const exportMetadata = exportResult.metadata;

  const handleCopy = () => {
    const fallbackCopy = (text: string) => {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.position = "fixed";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error('Fallback copy failed', err);
      }
      document.body.removeChild(textArea);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(productionJson).catch(() => fallbackCopy(productionJson));
    } else {
      fallbackCopy(productionJson);
    }
  };

  /*
  const _handleTap = (tile: Tile) => {
    // Play the primary note
    playNote(tile.notes[0]);
  };

  const _handleHoldBeat = (note: ParsedNote) => {
    playNote(note);
  };

  const _handleHoldRelease = (tile: Tile) => {
    releaseNote(tile.notes[0]);
  };
  */

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="persistent"
      sx={{
        width: open ? 450 : 0,
        flexShrink: 0,
        transition: theme => theme.transitions.create('width', {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.leavingScreen,
        }),
        '& .MuiDrawer-paper': {
          width: 450,
          boxSizing: 'border-box',
          bgcolor: '#0f172a',
          borderLeft: '1px solid #1e293b',
          zIndex: (theme) => theme.zIndex.drawer + 2
        },
      }}
    >
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#1e293b' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', fontSize: '1.1rem' }}>
              Project Inspector
            </Typography>
          </Stack>
          <IconButton onClick={onClose} size="small" sx={{ color: '#94a3b8' }}>
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ borderColor: '#334155' }} />

        {/* Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: '#334155', bgcolor: '#1e293b' }}>
          <Tabs
            value={activeTab}
            onChange={(_, val) => setActiveTab(val)}
            variant="fullWidth"
            textColor="primary"
            indicatorColor="primary"
          >
            <Tab
              icon={<CodeIcon sx={{ fontSize: 18 }} />}
              iconPosition="start"
              label="Production JSON"
              sx={{ minHeight: 48, fontSize: '0.8rem', fontWeight: 600 }}
            />
            <Tab
              icon={<ViewQuiltIcon sx={{ fontSize: 18 }} />}
              iconPosition="start"
              label="Tile Layout"
              sx={{ minHeight: 48, fontSize: '0.8rem', fontWeight: 600 }}
            />
          </Tabs>
        </Box>

        {/* Content */}
        <Box sx={{ flexGrow: 1, overflow: 'hidden', position: 'relative' }}>
          {activeTab === 0 && (
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ p: 1, borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 2, bgcolor: '#0f172a' }}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, ml: 1 }}>
                  Bar Range:
                </Typography>
                <TextField
                  size="small"
                  label="Start"
                  type="number"
                  value={startBar}
                  onChange={(e) => setStartBar(Math.max(1, parseInt(e.target.value) || 1))}
                  sx={{ width: 70, '& .MuiInputBase-input': { fontSize: '0.75rem', py: 0.5, color: 'white' } }}
                />
                <TextField
                  size="small"
                  label="End"
                  type="number"
                  placeholder="Max"
                  value={endBar}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEndBar(val === '' ? '' : Math.max(1, parseInt(val) || 1));
                  }}
                  sx={{ width: 70, '& .MuiInputBase-input': { fontSize: '0.75rem', py: 0.5, color: 'white' } }}
                />
                <Box sx={{ flexGrow: 1 }} />
                <Tooltip title="Copy to Clipboard">
                  <Button
                    size="small"
                    startIcon={<ContentCopyIcon />}
                    onClick={handleCopy}
                    sx={{ color: '#38bdf8', fontSize: '0.7rem' }}
                  >
                    Copy
                  </Button>
                </Tooltip>
              </Box>
              <Box sx={{ flexGrow: 1, overflow: 'auto', p: 0, bgcolor: '#0f172a' }}>
                <Box sx={{ p: 2, fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem' }}>
                  {(() => {
                    let currentTrackIdx = -1;
                    const trackBarOffsets: Record<number, number> = {};

                    return productionJson.split('\n').map((line, i) => {
                      const isScoreListStart = line.includes('"scores": [');
                      const isScoreDataLine = line.includes('        "');
                      const isKey = line.includes('":');

                      if (isScoreListStart) {
                        currentTrackIdx = -1; // Reset or prepare for next array
                      }

                      if (isScoreDataLine) {
                        currentTrackIdx++;
                        if (trackBarOffsets[currentTrackIdx] === undefined) {
                          trackBarOffsets[currentTrackIdx] = startBar;
                        }

                        const padding = line.match(/^(\s*)/)?.[1] || "";
                        const rawTrackContent = line.match(/"(.*)"/)?.[1] || "";
                        const bars = rawTrackContent.split(';').filter(b => b.trim() !== "");

                        const renderedLine = (
                          <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            <span style={{ color: '#94a3b8' }}>{padding}"</span>
                            {bars.map((_barStr, bi) => {
                              const barNumber = trackBarOffsets[currentTrackIdx] + bi;
                              const barTokens = exportMetadata[currentTrackIdx]?.[barNumber] || [];

                              return (
                                <span key={bi}>
                                  {barTokens.map((t, ti) => {
                                    const isHovered = hoveredNoteId && t.noteId === hoveredNoteId;
                                    const isComma = ti < barTokens.length - 1;

                                    return (
                                      <React.Fragment key={ti}>
                                        <span
                                          style={{
                                            color: isHovered ? '#38bdf8' : '#fbbf24',
                                            backgroundColor: isHovered ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s',
                                            padding: '0 2px',
                                            borderRadius: '2px',
                                            fontWeight: isHovered ? 700 : 400,
                                            boxShadow: isHovered ? '0 0 8px rgba(56, 189, 248, 0.4)' : 'none'
                                          }}
                                          onMouseEnter={() => t.noteId && onHoverNote?.(t.noteId)}
                                          onMouseLeave={() => onHoverNote?.(null)}
                                        >
                                          {t.token}
                                        </span>
                                        {isComma && <span style={{ color: '#64748b' }}>,</span>}
                                      </React.Fragment>
                                    );
                                  })}
                                  <span style={{ color: '#64748b' }}>;</span>
                                </span>
                              );
                            })}
                            <span style={{ color: '#94a3b8' }}>",</span>
                          </div>
                        );

                        trackBarOffsets[currentTrackIdx] += bars.length;
                        return renderedLine;
                      }

                      return (
                        <div key={i} style={{ minHeight: '1.2em', color: '#94a3b8' }}>
                          {isKey ? (
                            <>
                              <span style={{ color: '#38bdf8' }}>{line.split('":')[0]}"</span>:
                              <span style={{ color: '#fbbf24' }}>{line.split('":')[1]}</span>
                            </>
                          ) : (
                            line
                          )}
                        </div>
                      );
                    });
                  })()}
                </Box>
              </Box>
            </Box>
          )}

          {activeTab === 1 && (
            <Box sx={{ height: '100%', bgcolor: '#020617', p: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden' }}>
              {!midResult ? (
                <Box sx={{ p: 4, textAlign: 'center', width: '100%' }}>
                  <ViewQuiltIcon sx={{ fontSize: 64, color: '#334155', mb: 2 }} />
                  <Typography variant="h6" sx={{ color: '#94a3b8', mb: 1 }}>
                    {notes.length === 0 ? "No Notes Found" : "Shadow Preview Engine"}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#64748b' }}>
                    {notes.length === 0 ? "Add some notes to the board to see the layout." : "Preparing board..."}
                  </Typography>
                </Box>
              ) : (
                <>
                  <Box
                    ref={scrollRef}
                    onScroll={handleManualScroll}
                    sx={{
                      flexGrow: 1,
                      width: '100%',
                      bgcolor: '#000814',
                      position: 'relative',
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      p: 0,
                      boxShadow: 'inset 0 0 100px rgba(0,0,0,0.9)',
                      '&::-webkit-scrollbar': { width: '8px' },
                      '&::-webkit-scrollbar-track': { bgcolor: 'rgba(0,0,0,0.1)' },
                      '&::-webkit-scrollbar-thumb': { bgcolor: '#475569', borderRadius: '4px', '&:hover': { bgcolor: '#64748b' } }
                    }}
                  >
                    {/* Padding at the end of the song (Top of container) */}
                    <Box sx={{ height: 300, width: '100%' }} />

                    {/* Render Tiles Layer */}
                    <Box sx={{ position: 'relative', width: '100%', height: midResult.totalHeight, flexShrink: 0 }}>
                      {/* Lane Dividers */}
                      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', pointerEvents: 'none' }}>
                        {[1, 2, 3].map(l => (
                          <Box key={l} sx={{
                            position: 'absolute',
                            left: `${l * 25}%`,
                            top: 0,
                            bottom: 0,
                            width: '1px',
                            bgcolor: 'rgba(255,255,255,0.05)'
                          }} />
                        ))}
                      </Box>

                      {midResult.tiles.map((tile) => {
                        const isMelody = tile.note.trackIndex === 0;
                        const accentColor = isMelody ? '#3b82f6' : '#10b981';

                        const commonStyle: React.CSSProperties = {
                          position: 'absolute',
                          left: `${tile.lane * 25}%`,
                          width: '25%',
                          height: tile.height,
                          top: tile.top,
                          backgroundColor: '#000',
                          border: `1px solid ${accentColor}4D`,
                          boxShadow: `inset 0 0 10px ${accentColor}1A`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '2px',
                          transition: 'none',
                          cursor: 'pointer',
                        };

                        const isHold = tile.slotSpan > 1.1;
                        const isHovered = tile.id === hoveredNoteId || tile.notes.some(n => n.id === hoveredNoteId);
                        const isSelected = tile.notes.some(n => n.id === selectedNoteId);

                        return (
                          <Box
                            key={tile.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectNote?.(tile.notes[0].id || null);
                              playNote(tile.notes[0]);
                            }}
                            onMouseEnter={() => onHoverNote?.(tile.notes[0].id || null)}
                            onMouseLeave={() => onHoverNote?.(null)}
                            sx={{
                              ...commonStyle,
                              zIndex: isSelected ? 110 : (isHovered ? 100 : 1),
                              borderColor: isSelected ? '#fbbf24' : (isHovered ? '#ffffff' : `${accentColor}4D`),
                              borderWidth: '1px',
                              ...(isHold && {
                                background: `linear-gradient(to bottom, ${accentColor}26 0%, #000 100%)`,
                                borderColor: isSelected ? '#fbbf24' : (isHovered ? '#ffffff' : accentColor),
                                borderWidth: '1px',
                                '&::after': {
                                  content: '""',
                                  position: 'absolute',
                                  width: '2px',
                                  top: 10,
                                  bottom: 15,
                                  left: '50%',
                                  bgcolor: `${accentColor}80`,
                                  boxShadow: `0 0 8px ${accentColor}`
                                }
                              })
                            }}
                          >
                              <Typography variant="caption" sx={{ 
                                position: 'absolute',
                                bottom: 8,
                                color: isHold ? accentColor : '#94a3b8', 
                                fontSize: '0.65rem', 
                                fontWeight: 700, 
                                pointerEvents: 'none', 
                                textAlign: 'center',
                                zIndex: 10
                              }}>
                                {tile.note.name}
                                {tile.notes.length > 1 && <span style={{ opacity: 0.8, fontSize: '0.6rem', display: 'block' }}>HOLD ({tile.notes.length})</span>}
                              </Typography>
                          </Box>
                        );
                      })}
                    </Box>

                    {/* Padding at the start of the song (Bottom of container) */}
                    <Box sx={{ height: 300, width: '100%' }} />
                  </Box>

                  {/* Visual Playhead Marker */}
                  <Box sx={{
                    position: 'absolute',
                    bottom: -1,
                    left: 0,
                    right: 0,
                    height: '4px',
                    bgcolor: '#ef4444',
                    zIndex: 100,
                    boxShadow: '0 -2px 10px rgba(239, 68, 68, 0.5)',
                    pointerEvents: 'none'
                  }} />
                </>
              )}
            </Box>
          )}
        </Box>

        {/* Inspector content ends here */}
      </Box>
    </Drawer>
  );
};
