import { useMemo, useRef, useState } from 'react';
import { useMidi } from './hooks/useMidi';
import { useSynth } from './hooks/useSynth';
import { usePlayback } from './hooks/usePlayback';
import { MidiDropzone } from './components/MidiDropzone';
import { TrackSelector } from './components/TrackSelector';
import { MidiInfoPanel } from './components/MidiInfoPanel';
import { NoteTable } from './components/NoteTable';
import { GameBoard } from './components/GameBoard';
import { LibraryTab } from './components/LibraryTab';
import type { GameTile, MidiParseResult, ParsedNote } from './types/midi';
import { MIN_HEIGHT } from './utils/midiParser';
import { devResult, DEV_SELECTED_TRACKS } from './dev/devResult';
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

  // Left panel tab state
  const [leftTab, setLeftTab] = useState<'notes' | 'library'>('notes');

  // Song picked from the Library tab
  const [pickedResult, setPickedResult] = useState<MidiParseResult | null>(null);

  const activeResult = DEV_SKIP_FILE ? (pickedResult ?? devResult) : result;
  const activeStage = DEV_SKIP_FILE ? 'ready' : stage;
  const activeSelectedTracks = DEV_SKIP_FILE ? DEV_SELECTED_TRACKS : selectedTracks;

  const playbackNotes = useMemo(
    () => activeResult?.notes ?? [],
    [activeResult],
  );
  const {
    isPlaying: isPlaybackPlaying,
    currentTime,
    play: playbackPlay,
    pause: playbackPause,
    stop: playbackStop,
  } = usePlayback(playbackNotes, activeResult?.info.durationSeconds ?? 0, playNoteScheduled);

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
    setLeftTab('notes');
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
              <div style={{ display: 'flex', gap: '8px', padding: '12px 16px', borderBottom: '1px solid #2a2a2a', background: '#0e0e0e' }}>
                <button
                  className="btn-ghost"
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                  onClick={() => {
                    handleSongSelect(devResult);
                  }}
                >
                  Load Jingle Bells
                </button>
                <button
                  className="btn-ghost"
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                  onClick={async () => {
                    const req = await fetch('/src/dev/Little Star.json');
                    if (req.ok) {
                      const sf = await req.json();
                      handleSongSelect(buildResultFromPianoTilesSong(sf, 0, 'Little Star'));
                    }
                  }}
                >
                  Load Little Star
                </button>
              </div>

              <div className="studio-tabs">
                <button
                  className={`studio-tab${leftTab === 'notes' ? ' studio-tab--active' : ''}`}
                  onClick={() => setLeftTab('notes')}
                >
                  Notes
                </button>
                <button
                  className={`studio-tab${leftTab === 'library' ? ' studio-tab--active' : ''}`}
                  onClick={() => setLeftTab('library')}
                >
                  Library
                </button>
              </div>

              {leftTab === 'notes' ? (
                <>
                  <MidiInfoPanel
                    info={activeResult.info}
                    tracks={activeResult.tracks}
                    selectedTracks={activeSelectedTracks}
                    tileCount={activeResult.tiles.length}
                    isPlaying={isPlaybackPlaying}
                    currentTime={currentTime}
                    onChangeTrack={handleReset}
                    onReset={handleReset}
                    onPlay={playbackPlay}
                    onPause={playbackPause}
                    onStop={playbackStop}
                    onCopyNotes={() => navigator.clipboard.writeText(JSON.stringify(activeResult.notes, null, 2))}
                    onCopyTiles={() => navigator.clipboard.writeText(JSON.stringify(activeResult.tiles, null, 2))}
                  />
                  <NoteTable tiles={activeResult.tiles} onTileTap={handleTileTap} />
                </>
              ) : (
                <LibraryTab
                  onSelect={handleSongSelect}
                  currentSongName={activeResult.info.name}
                />
              )}
            </div>

            {/* Right — game board */}
            <div className="studio__board" style={{ position: 'relative' }}>
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
                onSpeedChange={(mult) => { speedRef.current = mult; }}
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
