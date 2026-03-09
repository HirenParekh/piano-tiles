import { useMemo, useRef, useState } from 'react';
import { useMidi } from './hooks/useMidi';
import { useSynth } from './hooks/useSynth';
import { usePlayback } from './hooks/usePlayback';
import { MidiDropzone } from './components/MidiDropzone';
import { TrackSelector } from './components/TrackSelector';
import { SongSelection } from './components/SongSelection';
import { GameBoard } from './components/GameBoard';
import type { GameTile, MidiParseResult, ParsedNote } from './types/midi';
import { MIN_HEIGHT } from './utils/midiParser';
import { devResult } from './dev/devResult';
import { buildResultFromPianoTilesSong } from './utils/pianoTilesParser';
import './styles/main.scss';

// ── Dev flag — set false to restore normal file-picker flow ────────────────
const DEV_SKIP_FILE = true;

export default function App() {
  const {
    stage, error,
    tracks, selectedTracks, toggleTrack, confirmTracks,
    result, loadFile, reset,
  } = useMidi();

  const { loaded: samplesLoaded, playNote, attackNote, releaseNote, playNoteScheduled, resumeContext } = useSynth();

  // Song picked from the Library tab
  const [pickedResult, setPickedResult] = useState<MidiParseResult | null>(null);

  const activeResult = DEV_SKIP_FILE ? (pickedResult ?? devResult) : result;
  const activeStage = DEV_SKIP_FILE ? 'ready' : stage;

  const playbackNotes = useMemo(
    () => activeResult?.notes ?? [],
    [activeResult],
  );
  const { stop: playbackStop } = usePlayback(
    playbackNotes,
    activeResult?.info.durationSeconds ?? 0,
    playNoteScheduled
  );

  const handleFile = async (file: File) => {
    await resumeContext();
    loadFile(file);
  };

  const holdTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const speedRef = useRef(1);
  const heldNoteRef = useRef<ParsedNote | null>(null);

  const handleTileTap = async (tile: GameTile) => {
    await resumeContext();

    holdTimersRef.current.forEach(clearTimeout);
    holdTimersRef.current = [];

    const speed = speedRef.current;
    const isHold = tile.height > MIN_HEIGHT;

    if (isHold) {
      // Hold tiles trigger an initial attack and sustain naturally without artificial Tremolo.
      attackNote({ ...tile.note, duration: tile.note.duration / speed });
      heldNoteRef.current = tile.note;
    } else {
      // Tap tiles just trigger once and are bound by the 8-second default release envelope.
      playNote({ ...tile.note, duration: tile.note.duration / speed });
    }

    tile.notes.slice(1).forEach((note) => {
      const delayMs = Math.round((note.time - tile.note.time) * 1000 / speed);
      const id = setTimeout(() => playNote({ ...note, duration: note.duration / speed }), delayMs);
      holdTimersRef.current.push(id);
    });
  };

  const handleHoldRelease = () => {
    if (heldNoteRef.current) {
      releaseNote(heldNoteRef.current);
      heldNoteRef.current = null;
    }
    holdTimersRef.current.forEach(clearTimeout);
    holdTimersRef.current = [];
  };

  const handleReset = () => {
    playbackStop();
    reset();
  };

  const handleSongSelect = (result: MidiParseResult) => {
    playbackStop();
    setPickedResult(result);
  };

  const handlePlaySong = async (id: string) => {
    try {
      const res = await fetch(`/songs/${encodeURIComponent(id)}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ptJson = await res.json();
      handleSongSelect(buildResultFromPianoTilesSong(ptJson, 0, id));
    } catch (err) {
      console.error('Failed to load song:', err);
      alert('Failed to load song: ' + id);
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__logo">
          <span className="logo-mark">♪</span>
          <span className="logo-text">PIANO<em>TILES</em></span>
        </div>
        <p className="app__subtitle">MIDI Parser &amp; Note Extractor</p>
      </header>

      <main className="app__main">

        {activeStage === 'idle' && <MidiDropzone onFile={handleFile} />}

        {activeStage === 'loading' && (
          <div className="status-msg">
            <span className="spinner">◐</span> Parsing MIDI file…
          </div>
        )}

        {activeStage === 'error' && (
          <div className="status-msg status-msg--error">
            <strong>Error:</strong> {error}
            <button className="btn-ghost" onClick={handleReset}>Try Again</button>
          </div>
        )}

        {activeStage === 'track-select' && (
          <TrackSelector
            tracks={tracks}
            selectedTracks={selectedTracks}
            onToggle={toggleTrack}
            onConfirm={confirmTracks}
            onReset={handleReset}
          />
        )}

        {activeStage === 'ready' && activeResult && (
          <div className="studio">

            {/* Left panel — tabbed */}
            <div className="studio__table">
              <SongSelection onPlaySong={handlePlaySong} />
            </div>

            {/* Right — game board */}
            <div className="studio__board">
              {!samplesLoaded && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(240,238,248,0.85)', fontSize: '13px', color: '#555',
                  fontFamily: 'monospace', letterSpacing: '0.05em',
                }}>
                  <span className="spinner">◐</span>&nbsp; Loading piano samples…
                </div>
              )}
              <GameBoard
                result={activeResult}
                onPlayNote={handleTileTap}
                onHoldRelease={handleHoldRelease}
              />
            </div>
          </div>
        )}

      </main>

      <footer className="app__footer">
        Piano Tiles Dev · @tonejs/midi + Tone.js + React + TypeScript
      </footer>
    </div>
  );
}
