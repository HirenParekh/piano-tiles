import { useMemo, useRef, useState } from 'react';
import { useSynth } from './hooks/useSynth';
import { usePlayback } from './hooks/usePlayback';
import { SongSelection } from './components/SongSelection';
import { GameBoard } from './components/GameBoard';
import type { GameTile, MidiParseResult, ParsedNote } from './types/midi';
import { MIN_HEIGHT } from './utils/midiParser';
import { buildResultFromPianoTilesSong } from './utils/pianoTilesParser';
import './styles/main.scss';
export default function App() {
  const { loaded: samplesLoaded, playNote, attackNote, releaseNote, playNoteScheduled, resumeContext } = useSynth();

  // Song picked from the Library tab
  const [pickedResult, setPickedResult] = useState<MidiParseResult | null>(null);

  const playbackNotes = useMemo(
    () => pickedResult?.notes ?? [],
    [pickedResult],
  );
  const { stop: playbackStop } = usePlayback(
    playbackNotes,
    pickedResult?.info.durationSeconds ?? 0,
    playNoteScheduled
  );

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
        {pickedResult ? (
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
              {/* Game Board */}
              <div style={{ position: 'absolute', top: 0, right: 0, background: 'blue', color: 'white', zIndex: 100, padding: '4px 8px', fontSize: 12, borderBottomLeftRadius: 4 }}>
                Piano Tiles
              </div>
              <GameBoard
                result={pickedResult}
                onPlayNote={handleTileTap}
                onHoldRelease={handleHoldRelease}
              />
            </div>
          </div>
        ) : (
          <div className="studio">
            <div className="studio__table">
              <SongSelection onPlaySong={handlePlaySong} />
            </div>
            <div className="studio__board">
              <div style={{
                position: 'absolute', inset: 0, zIndex: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(240,238,248,0.85)', fontSize: '15px', color: '#555',
                fontFamily: 'sans-serif'
              }}>
                Please select a song to start playing
              </div>
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
