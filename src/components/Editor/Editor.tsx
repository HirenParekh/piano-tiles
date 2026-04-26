import React, { useState, useRef, useEffect } from 'react';
import { Midi } from '@tonejs/midi';
import * as Tone from 'tone';
import { 
  ThemeProvider, createTheme, CssBaseline, Box, Toolbar, AppBar, 
  Typography, Button, IconButton, Drawer, List, ListItem, 
  ListItemText, Switch, Divider, Select, MenuItem, Stack, TextField,
  FormControl, InputLabel, Dialog, Slider, Snackbar, Alert, Menu
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import DownloadIcon from '@mui/icons-material/Download';
import CodeIcon from '@mui/icons-material/Code';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import { InspectorPanel } from './InspectorPanel';

import { PianoRoll } from './PianoRoll';
import { useSynth } from '../../hooks/useSynth';
import { buildResultFromPianoTilesSong } from '../../utils/pianoTilesParser';
import { midiToPitch } from '../../utils/pianoTilesExporter';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#3b82f6',
    },
    background: {
      default: '#0f172a',
      paper: '#1e293b',
    },
    text: {
      primary: '#f8fafc',
      secondary: '#94a3b8',
    }
  },
  typography: {
    fontFamily: '"Inter", "Bebas Neue", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#0f172a',
          borderRight: '1px solid #1e293b',
        }
      }
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#0f172a',
          borderBottom: '1px solid #1e293b',
          backgroundImage: 'none'
        }
      }
    }
  }
});

const TRACK_COLORS_SOLID = [
  '#3b82f6', // Blue
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#ef4444', // Red
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#06b6d4', // Cyan
];

const drawerWidth = 280;

const TransportClock: React.FC = () => {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const handleUpdate = (e: any) => {
      const isObject = typeof e.detail === 'object' && e.detail !== null;
      setTime(isObject ? e.detail.time : e.detail);
    };
    window.addEventListener('editor-playback-update', handleUpdate);
    return () => window.removeEventListener('editor-playback-update', handleUpdate);
  }, []);

  const mins = Math.floor(time / 60);
  const secs = Math.floor(time % 60);
  const ms = Math.floor((time % 1) * 1000);

  return (
    <Box sx={{ 
      fontFamily: '"JetBrains Mono", "Space Mono", monospace', 
      fontSize: '20px', 
      color: '#38bdf8', 
      bgcolor: '#020617', 
      py: 0.5,
      px: 1.5, 
      borderRadius: 1, 
      border: '1px solid #1e293b',
      boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)',
      minWidth: '120px',
      textAlign: 'center',
    }}>
      {mins.toString().padStart(2, '0')}:{secs.toString().padStart(2, '0')}.{ms.toString().padStart(3, '0')}
    </Box>
  );
};

export const Editor: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const [bpm, setBpm] = useState(120);
  const [baseBeats, setBaseBeats] = useState(0.5);
  const [zoomY, setZoomY] = useState(1.0);
  const [isPitchLocked, setIsPitchLocked] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [snapResolution, setSnapResolution] = useState(0.25); // default 1/16 note
  const [folded, setFolded] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioSuspended, setAudioSuspended] = useState(false);
  const [notes, setNotes] = useState<any[]>([]);
  const [tracks, setTracks] = useState<{ name: string; index: number; visible: boolean; color: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const gameJsonInputRef = useRef<HTMLInputElement>(null);
  
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [fileMenuAnchor, setFileMenuAnchor] = useState<null | HTMLElement>(null);
  const { playNote, attackNote, releaseNote, loadInstruments, resumeContext } = useSynth();
  
  // Non-state playback trackers for 60FPS performance
  const playbackTimeRef = useRef<number>(0);
  const lastPlayedTimeRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);

  const historyRef = useRef<any[]>([]);
  const futureRef = useRef<any[]>([]);

  // Capture current state for history
  const pushToHistory = () => {
    const currentState = { notes, tracks, bpm, baseBeats };
    historyRef.current.push(JSON.stringify(currentState));
    if (historyRef.current.length > 50) historyRef.current.shift();
    futureRef.current = []; // Clear redo stack on new action
  };

  const handleUndo = () => {
    if (historyRef.current.length === 0) return;
    
    // Push current state to future
    const currentState = { notes, tracks, bpm, baseBeats };
    futureRef.current.push(JSON.stringify(currentState));
    
    // Restore from history
    const prevStateStr = historyRef.current.pop();
    const prevState = JSON.parse(prevStateStr);
    
    setNotes(prevState.notes);
    setTracks(prevState.tracks);
    setBpm(prevState.bpm);
    setBaseBeats(prevState.baseBeats);
  };

  const handleRedo = () => {
    if (futureRef.current.length === 0) return;
    
    // Push current state to past
    const currentState = { notes, tracks, bpm, baseBeats };
    historyRef.current.push(JSON.stringify(currentState));
    
    // Restore from future
    const nextStateStr = futureRef.current.pop();
    const nextState = JSON.parse(nextStateStr);
    
    setNotes(nextState.notes);
    setTracks(nextState.tracks);
    setBpm(nextState.bpm);
    setBaseBeats(nextState.baseBeats);
  };



  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'info' | 'warning' | 'error' }>({ 
    open: false, 
    message: '', 
    severity: 'info' 
  });

  const notify = (message: string, severity: 'success' | 'info' | 'warning' | 'error' = 'info') => {
    setToast({ open: true, message, severity });
  };

  // Check state on mount
  useEffect(() => {
    // Check if audio is suspended (browser policy)
    if (Tone.context.state !== 'running') {
      setAudioSuspended(true);
    }

    const handleStateChange = () => {
      if (Tone.context.state === 'running') {
        setAudioSuspended(false);
      }
    };

    Tone.context.on('statechange', handleStateChange);
    return () => {
      Tone.context.off('statechange', handleStateChange);
    };
  }, []);

  const handleStartAudio = async () => {
    loadInstruments(['piano']); // Load only after first click to avoid auto-play warnings
    await resumeContext();
    setAudioSuspended(false);
  };

  // Audio Playback & Visual Sync Loop (Zero React Renders)
  useEffect(() => {
    let reqId: number;
    
    if (isPlaying) {
      lastFrameTimeRef.current = performance.now();
      
      const activeNoteList = notes.filter(n => {
        const track = tracks.find(t => t.index === n.trackIndex);
        return track?.visible;
      });

      const loop = () => {
        const now = performance.now();
        const deltaReal = (now - lastFrameTimeRef.current) / 1000;
        lastFrameTimeRef.current = now;
        
        // Advance virtual time by delta * speed
        const currentPlayback = playbackTimeRef.current + (deltaReal * playbackSpeed);
        
        // Trigger Audio
        activeNoteList.forEach(note => {
          if (note.start >= lastPlayedTimeRef.current && note.start < currentPlayback) {
            playNote({
              midi: note.pitch,
              velocity: note.velocity || 0.7,
              instrument: 'piano',
              name: '', 
              time: 0,
              duration: note.duration / playbackSpeed
            } as any);
          }
        });

        lastPlayedTimeRef.current = currentPlayback;
        playbackTimeRef.current = currentPlayback;
        
        // Broadcast time to Piano Roll for 60FPS canvas manipulation without React re-renders
        window.dispatchEvent(new CustomEvent('editor-playback-update', { 
          detail: { time: currentPlayback, forceScroll: true } 
        }));
        
        reqId = requestAnimationFrame(loop);
      };
      
      reqId = requestAnimationFrame(loop);
    } else {
      // Pause
      lastPlayedTimeRef.current = playbackTimeRef.current;
      window.dispatchEvent(new CustomEvent('editor-playback-update', { 
        detail: { time: playbackTimeRef.current, forceScroll: false } 
      }));
    }
    
    return () => cancelAnimationFrame(reqId);
  }, [isPlaying, notes, tracks, playNote, playbackSpeed]);

  // Handle user scrubbing
  useEffect(() => {
    const handleScrub = (e: any) => {
      const scrubTime = e.detail;
      const prevTime = playbackTimeRef.current;
      playbackTimeRef.current = scrubTime;
      
      if (!isPlaying) {
        if (scrubTime > prevTime) {
          const activeNoteList = notes.filter(n => tracks.find(t => t.index === n.trackIndex)?.visible);
          activeNoteList.forEach(note => {
            if (note.start >= prevTime && note.start < scrubTime) {
              playNote({
                midi: note.pitch,
                velocity: note.velocity || 0.7,
                instrument: 'piano',
                name: '',
                time: 0, 
                duration: 0.15 // Short preview
              } as any);
            }
          });
        }
        window.dispatchEvent(new CustomEvent('editor-playback-update', { detail: scrubTime }));
      }
    };
    
    window.addEventListener('editor-user-scrub', handleScrub);
    return () => window.removeEventListener('editor-user-scrub', handleScrub);
  }, [isPlaying, notes, tracks, playNote]);

  // Initial Restoration
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pianoTiles_editorState');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.notes) setNotes(parsed.notes);
        if (parsed.tracks) setTracks(parsed.tracks);
        if (parsed.bpm) setBpm(parsed.bpm);
        if (parsed.baseBeats) {
          setBaseBeats(parsed.baseBeats);
          setSnapResolution(parsed.baseBeats); // Sync snap to the saved baseBeats
        }
        console.log('Restored editor state from localStorage');
      }
    } catch(err) {
      console.warn("Failed to restore editor state", err);
    }
  }, []);

  // Global Autosave Effect
  useEffect(() => {
    if (notes.length === 0 && !bpm) return; // Don't overwrite if empty yet

    const saveState = () => {
      try {
        const data = { notes, tracks, bpm, baseBeats };
        localStorage.setItem('pianoTiles_editorState', JSON.stringify(data));
      } catch (e) {
        console.warn("Autosave failed. Storage may be full.", e);
      }
    };

    // Debounce saves to prevent lag during aggressive dragging
    const timeout = setTimeout(saveState, 500);
    return () => clearTimeout(timeout);
  }, [notes, tracks, bpm, baseBeats]);

  const toggleTrackVisibility = (idx: number) => {
    pushToHistory();
    setTracks(prev => prev.map(t => t.index === idx ? { ...t, visible: !t.visible } : t));
  };

  const handleNoteUpdate = (updatedNote: any) => {
    pushToHistory();
    setNotes(prev => prev.map(n => n.id === updatedNote.id ? updatedNote : n));
  };

  const handleNoteDelete = (id: string) => {
    pushToHistory();
    setNotes(prev => prev.filter(n => n.id !== id));
  };

  const trimLeadingSilence = () => {
    if (notes.length === 0) return;
    const earliestStart = Math.min(...notes.map(n => n.start));
    if (earliestStart <= 0) return;

    pushToHistory();
    const newNotes = notes.map(n => ({ ...n, start: Math.max(0, n.start - earliestStart) }));
    setNotes(newNotes);
    notify(`Shifted all notes back by ${earliestStart.toFixed(2)}s to remove leading silence`, 'success');
    
    // Update local storage
    const saved = localStorage.getItem('pianoTiles_editorState');
    if (saved) {
      const parsed = JSON.parse(saved);
      localStorage.setItem('pianoTiles_editorState', JSON.stringify({ ...parsed, notes: newNotes }));
    }
  };

  const handleQuantizeSelectedNote = () => {
    if (!selectedNoteId) return;
    const selectedNote = notes.find(n => n.id === selectedNoteId);
    if (!selectedNote) return;

    const isMelody = selectedNote.trackIndex === 0;
    
    // Find future notes
    const futureNotes = notes.filter(n => {
      if (n.id === selectedNoteId) return false;
      if (n.start <= selectedNote.start + 0.001) return false;
      if (isMelody && n.trackIndex !== 0) return false;
      return true;
    });

    if (futureNotes.length === 0) {
      notify("No overlapping future notes found.", "info");
      return;
    }

    const nextStart = Math.min(...futureNotes.map(n => n.start));

    if (selectedNote.start + selectedNote.duration > nextStart + 0.001) {
      pushToHistory();
      const secPerBeat = 60 / bpm;
      const snapSec = snapResolution * secPerBeat;
      const maxAllowedDuration = nextStart - selectedNote.start;
      
      // Add a small epsilon to prevent floating-point errors (e.g. 1.999999 becoming 1 instead of 2)
      let newDuration = Math.floor((maxAllowedDuration / snapSec) + 0.001) * snapSec;
      
      if (newDuration < snapSec) newDuration = snapSec;

      const newNotes = notes.map(n => 
        n.id === selectedNoteId ? { ...n, duration: newDuration } : n
      );
      setNotes(newNotes);
      notify(`Quantized duration to ${newDuration.toFixed(2)}s to resolve overlap.`, 'success');
    } else {
      notify("Note does not overlap with next note.", "info");
    }
  };

  const handlePrevNote = () => {
    if (!selectedNoteId) return;
    const sn = notes.find(n => n.id === selectedNoteId);
    if (!sn) return;
    const trackNotes = notes.filter(n => n.trackIndex === sn.trackIndex).sort((a, b) => a.start - b.start);
    const idx = trackNotes.findIndex(n => n.id === selectedNoteId);
    if (idx > 0) {
      const prev = trackNotes[idx - 1];
      setSelectedNoteId(prev.id);
      window.dispatchEvent(new CustomEvent('editor-ensure-visible', { detail: { start: prev.start, pitch: prev.pitch } }));
    }
  };

  const handleNextNote = () => {
    if (!selectedNoteId) return;
    const sn = notes.find(n => n.id === selectedNoteId);
    if (!sn) return;
    const trackNotes = notes.filter(n => n.trackIndex === sn.trackIndex).sort((a, b) => a.start - b.start);
    const idx = trackNotes.findIndex(n => n.id === selectedNoteId);
    if (idx >= 0 && idx < trackNotes.length - 1) {
      const next = trackNotes[idx + 1];
      setSelectedNoteId(next.id);
      window.dispatchEvent(new CustomEvent('editor-ensure-visible', { detail: { start: next.start, pitch: next.pitch } }));
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if target is an input/textarea to avoid triggering shortcuts while typing
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) handleRedo(); else handleUndo();
        } else if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          handleRedo();
        }
      } else {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handlePrevNote();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleNextNote();
        } else if (e.key.toLowerCase() === 'q') {
          e.preventDefault();
          handleQuantizeSelectedNote();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [notes, tracks, bpm, baseBeats, selectedNoteId]);

  const handleMidiUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    pushToHistory();
    try {
      const arrayBuffer = await file.arrayBuffer();
      const midi = new Midi(arrayBuffer);
      
      const newTracks = midi.tracks.map((track, i) => ({
        name: track.name || `Track ${i + 1}`,
        index: i,
        visible: true,
        color: TRACK_COLORS_SOLID[i % TRACK_COLORS_SOLID.length]
      }));

      setTracks(newTracks);

      const simplifiedNotes = midi.tracks.flatMap((track, trackIdx) => 
        track.notes.map((note, noteIdx) => ({
          id: `t${trackIdx}-n${noteIdx}-${note.time}`,
          pitch: note.midi,
          start: note.time,
          duration: note.duration,
          velocity: note.velocity,
          track: track.name || `Track ${trackIdx + 1}`,
          trackIndex: trackIdx,
          color: TRACK_COLORS_SOLID[trackIdx % TRACK_COLORS_SOLID.length]
        }))
      );

      setNotes(simplifiedNotes);
      let finalBpm = 68;
      if (midi.header.tempos.length > 0) {
        finalBpm = Math.round(midi.header.tempos[0].bpm);
        setBpm(finalBpm);
      }

      // Save to localStorage
      try {
        localStorage.setItem('pianoTiles_editorState', JSON.stringify({
          notes: simplifiedNotes,
          tracks: newTracks,
          bpm: finalBpm
        }));
      } catch(e) {
        console.warn("Could not save to localStorage. File might be too large.", e);
      }

      console.log('Loaded MIDI:', midi);
      notify(`Successfully imported ${simplifiedNotes.length} notes`, 'success');
    } catch (err) {
      console.error('Failed to parse MIDI:', err);
      notify('Error parsing MIDI file. Check console.', 'error');
    }
  };

  const openProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    pushToHistory();
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (data.notes && Array.isArray(data.notes)) {
        setNotes(data.notes);
        if (data.tracks) setTracks(data.tracks);
        if (data.bpm) setBpm(data.bpm);
        if (data.baseBeats) setBaseBeats(data.baseBeats);
        if (data.snapResolution) setSnapResolution(data.snapResolution);
        if (data.zoomY) setZoomY(data.zoomY);
        if (data.folded !== undefined) setFolded(data.folded);
        if (data.playbackSpeed) setPlaybackSpeed(data.playbackSpeed);
        
        notify("Project loaded successfully!", "success");
      } else {
        notify("Invalid Project JSON format.", "error");
      }
    } catch (err) {
      console.error('Failed to open project:', err);
      notify('Error opening Project file.', "error");
    }
  };

  const handleGameJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    pushToHistory();
    try {
      const text = await file.text();
      const songData = JSON.parse(text);
      
      // Use the existing utility parser to handle the string-based score format
      const parsed = buildResultFromPianoTilesSong(songData, 0, file.name);
      
      if (!parsed.notes || parsed.notes.length === 0) {
        alert("Could not parse any notes from this Game JSON.");
        return;
      }

      const newNotes = parsed.notes.map((n, idx) => ({
        id: `gn-${idx}-${n.time}-${Math.random().toString(36).substr(2, 5)}`,
        pitch: n.midi,
        start: n.time,
        duration: n.duration,
        trackIndex: n.trackIndex,
        color: TRACK_COLORS_SOLID[n.trackIndex % TRACK_COLORS_SOLID.length]
      }));
      
      const uniqueTrackIndices = Array.from(new Set(newNotes.map(n => n.trackIndex))).sort((a,b) => a-b);
      const newTracks = uniqueTrackIndices.map(tIdx => ({
        name: tIdx === 0 ? 'Melody' : tIdx === 1 ? 'Bass' : `Track ${tIdx + 1}`,
        index: tIdx,
        visible: true,
        color: TRACK_COLORS_SOLID[tIdx % TRACK_COLORS_SOLID.length]
      }));
      
      setNotes(newNotes);
      setTracks(newTracks);
      
      const songBpm = songData.baseBpm || parsed.info.bpm || 120;
      const songBaseBeats = songData.musics?.[0]?.baseBeats || 0.5;
      
      setBpm(songBpm);
      setBaseBeats(songBaseBeats);
      
      notify(`Loaded ${newNotes.length} notes from Game JSON!`, "success");
      
      // Save to localStorage
      localStorage.setItem('pianoTiles_editorState', JSON.stringify({
        notes: newNotes,
        tracks: newTracks,
        bpm: songBpm,
        baseBeats: songBaseBeats
      }));
      
    } catch (err) {
      console.error('Failed to parse Game JSON:', err);
      notify('Error parsing Game JSON format.', "error");
    }
  };

  const saveProject = () => {
    const data = {
      notes,
      tracks,
      bpm,
      baseBeats,
      snapResolution,
      zoomY,
      folded,
      playbackSpeed,
      version: "1.1",
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.href = url;
    link.download = `piano-project-${timestamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', userSelect: 'text', WebkitUserSelect: 'text' }}>
        
        {/* TOP APP BAR */}
        <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
          <Toolbar variant="dense" sx={{ minHeight: 64 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <IconButton edge="start" onClick={onExit} sx={{ mr: 2, color: 'text.secondary' }}>
                <ArrowBackIcon />
              </IconButton>
              <Typography variant="h6" noWrap component="div" sx={{ fontWeight: 'bold', mr: 3 }}>
                PianoStudio 
                <Typography component="span" sx={{ color: 'text.secondary', ml: 1, fontSize: '0.8rem', fontWeight: 500 }}>
                  SaaS Editor
                </Typography>
              </Typography>
              
              <Button color="inherit" onClick={(e) => setFileMenuAnchor(e.currentTarget)} sx={{ color: '#94a3b8' }}>
                File
              </Button>
              <Menu anchorEl={fileMenuAnchor} open={Boolean(fileMenuAnchor)} onClose={() => setFileMenuAnchor(null)}>
                <MenuItem onClick={() => { fileInputRef.current?.click(); setFileMenuAnchor(null); }}>Import MIDI</MenuItem>
                <MenuItem onClick={() => { jsonInputRef.current?.click(); setFileMenuAnchor(null); }}>Open Project</MenuItem>
                <MenuItem onClick={() => { saveProject(); setFileMenuAnchor(null); }}>Save Project</MenuItem>
                <MenuItem onClick={() => { gameJsonInputRef.current?.click(); setFileMenuAnchor(null); }}>Load Game JSON</MenuItem>
              </Menu>
            </Box>

            <Box sx={{ 
              position: 'absolute', left: '50%', transform: 'translateX(-50%)', 
              display: 'flex', alignItems: 'center', gap: 2 
            }}>
              <TransportClock />
              
              <Stack direction="row" spacing={1} sx={{ mr: 2 }}>
                <IconButton 
                  color={isPlaying ? "warning" : "primary"}
                  onClick={async () => {
                    if (!isPlaying) {
                      loadInstruments(['piano']); // Ensure audio is ready
                      await resumeContext();
                    }
                    setIsPlaying(!isPlaying);
                  }}
                  sx={{ 
                    bgcolor: isPlaying ? 'rgba(245, 158, 11, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                    p: 1.2
                  }}
                >
                  {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                </IconButton>
                
                <IconButton 
                  color="inherit"
                  onClick={() => { 
                    setIsPlaying(false); 
                    playbackTimeRef.current = 0; 
                    lastPlayedTimeRef.current = 0;
                    window.dispatchEvent(new CustomEvent('editor-playback-update', { detail: { time: 0, forceScroll: true } }));
                  }}
                >
                  <StopIcon />
                </IconButton>
              </Stack>

              <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: '#334155' }} />

              <Stack direction="row" spacing={0.5} sx={{ ml: 2 }}>
                <IconButton 
                  disabled={historyRef.current.length === 0}
                  onClick={handleUndo}
                  title="Undo (Ctrl+Z)"
                  size="small"
                >
                  <UndoIcon fontSize="small" />
                </IconButton>
                <IconButton 
                  disabled={futureRef.current.length === 0}
                  onClick={handleRedo}
                  title="Redo (Ctrl+Y)"
                  size="small"
                >
                  <RedoIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Box>
            
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <IconButton 
                onClick={() => setInspectorOpen(!inspectorOpen)}
                sx={{ 
                  color: inspectorOpen ? 'primary.main' : 'text.secondary',
                  bgcolor: inspectorOpen ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                  mr: 1
                }}
              >
                <CodeIcon />
              </IconButton>
            </Box>
          </Toolbar>
        </AppBar>

        {/* LEFT SIDEBAR (DRAWER) */}
        <Drawer
          variant="permanent"
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
          }}
        >
          <Toolbar variant="dense" sx={{ minHeight: 64 }} /> {/* Spacer matching AppBar */}
          
          <Box sx={{ overflowY: 'auto', overflowX: 'hidden' }}>
            <Box sx={{ p: 2 }}>
              {/* Hidden file inputs moved from File Operations */}
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".mid,.midi" onChange={handleMidiUpload} />
              <input type="file" ref={jsonInputRef} style={{ display: 'none' }} accept=".json" onChange={openProject} />
              <input type="file" ref={gameJsonInputRef} style={{ display: 'none' }} accept=".json" onChange={handleGameJsonUpload} />

              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Note Info & Actions
              </Typography>
              
              {selectedNoteId ? (() => {
                const sn = notes.find(n => n.id === selectedNoteId);
                if (!sn) return <Typography variant="body2" color="text.secondary">Select a note</Typography>;
                
                const tonePitch = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][sn.pitch % 12] + (Math.floor(sn.pitch / 12) - 1);
                const pt2Pitch = midiToPitch(sn.pitch);
                
                const secPerBeat = 60 / bpm;
                const startBeats = sn.start / secPerBeat;
                const bar = Math.floor(startBeats / 4) + 1;
                const beat = Math.floor(startBeats % 4) + 1;
                const frac = (startBeats % 1).toFixed(2);

                return (
                  <Box sx={{ bgcolor: 'rgba(0,0,0,0.2)', p: 1.5, borderRadius: 1, mb: 1 }}>
                    <Typography variant="caption" sx={{ color: sn.color || '#fff', fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                      {sn.track}
                    </Typography>
                    
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>Key: {tonePitch} ({sn.pitch})</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>JSON: {pt2Pitch}</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', mt: 1 }}>Pos: {bar}:{beat}:{frac}</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>Dur: {sn.duration.toFixed(3)}s</Typography>
                    
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                      <IconButton size="small" onClick={handlePrevNote} sx={{ bgcolor: 'rgba(255,255,255,0.05)', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}>
                        <SkipPreviousIcon fontSize="small" />
                      </IconButton>
                      <Button 
                        fullWidth 
                        variant="contained" 
                        size="small" 
                        color="primary" 
                        onClick={handleQuantizeSelectedNote}
                        sx={{ fontWeight: 'bold' }}
                      >
                        Quantize
                      </Button>
                      <IconButton size="small" onClick={handleNextNote} sx={{ bgcolor: 'rgba(255,255,255,0.05)', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}>
                        <SkipNextIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Box>
                );
              })() : (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Select a note to view actions.
                </Typography>
              )}

              <Button 
                fullWidth 
                variant="outlined" 
                color="warning"
                startIcon={<span className="material-icons-round" style={{ fontSize: '18px' }}>content_cut</span>} 
                onClick={trimLeadingSilence}
                sx={{ mt: 1 }}
              >
                Trim Empty Beats
              </Button>
            </Box>

            <Divider />

            <Box sx={{ p: 2 }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Global Settings
              </Typography>
              <Stack spacing={2}>
                <Box>
                  <TextField 
                    label="Song BPM" 
                    type="number" 
                    size="small"
                    fullWidth
                    value={bpm}
                    onChange={(e) => {
                      pushToHistory();
                      setBpm(Number(e.target.value));
                    }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    Standard musical speed (beats per minute)
                  </Typography>
                </Box>

                <Box>
                  <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="caption" color="text.secondary">Base Beats</Typography>
                    <Button 
                      size="small" 
                      variant="text" 
                      onClick={() => {
                        if (notes.length === 0) return;
                        const beatDurations = notes.map(n => n.duration * (bpm / 60));
                        const minDur = Math.min(...beatDurations.filter(d => d > 0.05));
                        
                        let suggested = 0.5;
                        // Be more conservative: only use 0.25 if notes are clearly 16ths or faster (< 0.2 beats)
                        if (minDur < 0.2) suggested = 0.25; 
                        else if (minDur < 0.4) suggested = 0.5;
                        else suggested = 1.0;
                        
                        setBaseBeats(suggested);
                        setSnapResolution(suggested); // 1:1 mapping is more intuitive for editing
                      }}
                      sx={{ fontSize: '0.65rem', py: 0 }}
                    >
                      Magic Detect
                    </Button>
                  </Stack>
                  <TextField 
                    type="number" 
                    step={0.1}
                    size="small"
                    fullWidth
                    value={baseBeats}
                    onChange={(e) => {
                      pushToHistory();
                      setBaseBeats(Number(e.target.value));
                    }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    Quantization scale (e.g. 0.5 = 1 slot per 1/8 note)
                  </Typography>
                </Box>

                <Box sx={{ 
                  bgcolor: 'rgba(56, 189, 248, 0.1)', 
                  p: 1.5, 
                  borderRadius: 1, 
                  border: '1px solid rgba(56, 189, 248, 0.2)' 
                }}>
                  <Typography variant="caption" color="secondary" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                    EFFECTIVE GAME SPEED
                  </Typography>
                  <Typography variant="h6" color="primary" sx={{ fontWeight: 800 }}>
                    {Math.round(bpm / baseBeats)} BPM
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Tiles per second: {((bpm / baseBeats) / 60).toFixed(2)}
                  </Typography>
                </Box>
                <FormControl size="small" fullWidth>
                  <InputLabel>Snap to Grid</InputLabel>
                  <Select
                    value={snapResolution}
                    label="Snap to Grid"
                    onChange={(e) => setSnapResolution(Number(e.target.value))}
                  >
                    <MenuItem value={1}>1/4 Note (Beat)</MenuItem>
                    <MenuItem value={0.5}>1/8 Note</MenuItem>
                    <MenuItem value={0.25}>1/16 Note</MenuItem>
                    <MenuItem value={0.125}>1/32 Note</MenuItem>
                    <MenuItem value={0.0625}>1/64 Note</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel>Playback Speed</InputLabel>
                  <Select
                    value={playbackSpeed}
                    label="Playback Speed"
                    onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                  >
                    <MenuItem value={0.1}>0.1x (Slow-mo)</MenuItem>
                    <MenuItem value={0.2}>0.2x</MenuItem>
                    <MenuItem value={0.25}>0.25x</MenuItem>
                    <MenuItem value={0.5}>0.5x (Half Speed)</MenuItem>
                    <MenuItem value={0.75}>0.75x</MenuItem>
                    <MenuItem value={1}>1.0x (Normal)</MenuItem>
                    <MenuItem value={1.25}>1.25x</MenuItem>
                    <MenuItem value={1.5}>1.5x</MenuItem>
                    <MenuItem value={2.0}>2.0x (Double Speed)</MenuItem>
                  </Select>
                </FormControl>

                <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">Fold Unused Keys</Typography>
                  <Switch 
                    size="small" 
                    color="primary"
                    checked={folded} 
                    onChange={() => setFolded(!folded)} 
                  />
                </Box>

                <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">Lock Pitch (Lane)</Typography>
                  <Switch 
                    size="small" 
                    color="secondary"
                    checked={isPitchLocked} 
                    onChange={() => setIsPitchLocked(!isPitchLocked)} 
                  />
                </Box>
              </Stack>

                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                    Vertical Zoom
                  </Typography>
                  <Slider
                    size="small"
                    value={zoomY}
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    onChange={(_, val) => setZoomY(val as number)}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(v) => `${v}x`}
                  />
                </Box>
              </Box>

            <Divider />

            <Box sx={{ p: 2 }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Tracks
              </Typography>
              {tracks.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  No tracks loaded
                </Typography>
              ) : (
                <List dense disablePadding>
                  {tracks.map(track => (
                    <ListItem 
                      key={track.index} 
                      sx={{ 
                        bgcolor: 'background.paper', 
                        mb: 0.5, 
                        borderRadius: 1, 
                        borderLeft: `4px solid ${track.color}` 
                      }}
                    >
                      <ListItemText 
                        primary={
                          <Typography variant="body2" sx={{ 
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: track.visible ? 'text.primary' : 'text.secondary' 
                          }}>
                            {track.name}
                          </Typography>
                        }
                      />
                      <Switch 
                        size="small" 
                        color="primary"
                        checked={track.visible} 
                        onChange={() => toggleTrackVisibility(track.index)} 
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>

          </Box>
        </Drawer>

        {/* MAIN CANVAS AREA */}
        <Box 
          component="main" 
          sx={{ 
            flexGrow: 1, 
            position: 'relative',
            transition: theme => theme.transitions.create('margin', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.leavingScreen,
            }),
            marginRight: inspectorOpen ? '450px' : 0
          }}
        >
          <Toolbar variant="dense" sx={{ minHeight: 64 }} /> {/* Spacer */}
          <Box sx={{ height: 'calc(100vh - 64px)', overflow: 'hidden', bgcolor: '#020617', userSelect: 'none', WebkitUserSelect: 'none' }}>
            <PianoRoll 
              notes={notes.filter(n => tracks.find(t => t.index === n.trackIndex)?.visible)} 
              bpm={bpm}
              snapResolution={snapResolution}
              folded={folded}
              isPitchLocked={isPitchLocked}
              rowHeight={24 * zoomY}
              onNoteUpdate={handleNoteUpdate}
              onNoteDelete={handleNoteDelete}
              hoveredNoteId={hoveredNoteId}
              onHoverNote={setHoveredNoteId}
              selectedNoteId={selectedNoteId}
              onSelectNote={setSelectedNoteId}
            />
          </Box>
        </Box>

        <InspectorPanel 
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          notes={notes}
          bpm={bpm}
          baseBeats={baseBeats}
          playNote={playNote}
          attackNote={attackNote}
          releaseNote={releaseNote}
          hoveredNoteId={hoveredNoteId}
          onHoverNote={setHoveredNoteId}
          selectedNoteId={selectedNoteId}
          onSelectNote={setSelectedNoteId}
        />

        <Dialog 
          open={audioSuspended} 
          maxWidth="xs" 
          fullWidth
        >
          <Box sx={{ 
            bgcolor: '#1e293b', 
            border: '1px solid #334155',
            textAlign: 'center',
            p: 4
          }}>
            <Box sx={{ py: 3 }}>
              <span className="material-icons-round" style={{ fontSize: '64px', color: '#38bdf8', marginBottom: '16px' }}>
                graphic_eq
              </span>
              <Typography variant="h5" gutterBottom sx={{ fontWeight: 700, color: 'white' }}>
                PianoStudio Editor
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 4, px: 2 }}>
                Your browser has muted audio until you interact with the page. 
                Click below to start the high-performance audio engine.
              </Typography>
              <Button 
                variant="contained" 
                size="large" 
                fullWidth
                startIcon={<PlayArrowIcon />}
                onClick={handleStartAudio}
                sx={{ 
                  py: 1.5,
                  borderRadius: '12px',
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  boxShadow: '0 8px 16px rgba(59, 130, 246, 0.3)'
                }}
              >
                Start Experience
              </Button>
            </Box>
          </Box>
        </Dialog>

        <Snackbar 
          open={toast.open} 
          autoHideDuration={6000} 
          onClose={() => setToast({ ...toast, open: false })}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert 
            onClose={() => setToast({ ...toast, open: false })} 
            severity={toast.severity} 
            variant="filled"
            sx={{ width: '100%', borderRadius: '12px', fontWeight: 600, boxShadow: '0 8px 16px rgba(0,0,0,0.4)' }}
          >
            {toast.message}
          </Alert>
        </Snackbar>

      </Box>
    </ThemeProvider>
  );
};
