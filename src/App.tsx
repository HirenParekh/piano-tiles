import { useMemo } from 'react';
import { useMidi } from './hooks/useMidi';
import { useSynth } from './hooks/useSynth';
import { usePlayback } from './hooks/usePlayback';
import { MidiDropzone } from './components/MidiDropzone';
import { TrackSelector } from './components/TrackSelector';
import { MidiInfoPanel } from './components/MidiInfoPanel';
import { NoteTable } from './components/NoteTable';
import { GameBoard } from './components/GameBoard';
import type { GameTile } from './types/midi';
import './styles/main.scss';

export default function App() {
  const {
    stage, error,
    tracks, selectedTracks, toggleTrack, confirmTracks,
    result, loadFile, reset,
  } = useMidi();

  const { playNote, playNoteScheduled, resumeContext } = useSynth();

  const playbackNotes = useMemo(
    () => result?.tiles.map(t => t.note) ?? [],
    [result],
  );
  const {
    isPlaying: isPlaybackPlaying,
    currentTime,
    play: playbackPlay,
    pause: playbackPause,
    stop: playbackStop,
  } = usePlayback(playbackNotes, result?.info.durationSeconds ?? 0, playNoteScheduled);

  const handleFile = async (file: File) => {
    await resumeContext();
    loadFile(file);
  };

  const handleTileTap = (tile: GameTile) => playNote(tile.note);
  const handleReset = () => {
    playbackStop();
    reset();
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

        {stage === 'idle' && <MidiDropzone onFile={handleFile} />}

        {stage === 'loading' && (
          <div className="status-msg">
            <span className="spinner">◐</span> Parsing MIDI file…
          </div>
        )}

        {stage === 'error' && (
          <div className="status-msg status-msg--error">
            <strong>Error:</strong> {error}
            <button className="btn-ghost" onClick={handleReset}>Try Again</button>
          </div>
        )}

        {stage === 'track-select' && (
          <TrackSelector
            tracks={tracks}
            selectedTracks={selectedTracks}
            onToggle={toggleTrack}
            onConfirm={confirmTracks}
            onReset={handleReset}
          />
        )}

        {stage === 'ready' && result && (
          <div className="studio">
            {/* Left — note table */}
            <div className="studio__table">
              <MidiInfoPanel
                info={result.info}
                tracks={result.tracks}
                selectedTracks={selectedTracks}
                tileCount={result.tiles.length}
                isPlaying={isPlaybackPlaying}
                currentTime={currentTime}
                onChangeTrack={handleReset}
                onReset={handleReset}
                onPlay={playbackPlay}
                onPause={playbackPause}
                onStop={playbackStop}
              />
              <NoteTable tiles={result.tiles} onTileTap={handleTileTap} />
            </div>

            {/* Right — game board */}
            <div className="studio__board">
              <GameBoard
                result={result}
                onPlayNote={handleTileTap}
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