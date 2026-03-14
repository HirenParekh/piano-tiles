import { useMemo, useRef, useState } from 'react';
import { useSynth } from './hooks/useSynth';
import { usePlayback } from './hooks/usePlayback';
import { SongSelection } from './components/SongSelection';
import { GameBoard } from './components/GameBoard';
import { CanvasGameBoard } from './components/CanvasGameBoard';
import type { MidiParseResult, ParsedNote } from './types/midi';
import type { Tile } from './types/track';
import { buildResultFromPianoTilesSong } from './utils/pianoTilesParser';
import songCatalog from './songCatalog.json';
import './styles/main.scss';
import { TileRendererWidget } from './components/TileRendererWidget';
export default function App() {
  const { loadInstruments, playNote, attackNote, releaseNote, playNoteScheduled, resumeContext } = useSynth();

  // Song picked from the Library tab
  const [pickedResult, setPickedResult] = useState<MidiParseResult | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const [useCanvas, setUseCanvas] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

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

  const handleTileTap = async (tile: Tile) => {
    await resumeContext();

    holdTimersRef.current.forEach(clearTimeout);
    holdTimersRef.current = [];

    const speed = speedRef.current;
    const isHold = tile.type === 'HOLD';
    const primaryNote = tile.notes[0];

    if (isHold) {
      // Hold tiles trigger an initial attack; merged notes fire position-based via onHoldBeat
      attackNote({ ...primaryNote, duration: primaryNote.duration / speed });
      heldNoteRef.current = primaryNote;
    } else {
      // Tap tiles just trigger once and are bound by the 8-second default release envelope.
      playNote({ ...primaryNote, duration: primaryNote.duration / speed });
      tile.notes.slice(1).forEach((note) => {
        const delayMs = Math.round((note.time - primaryNote.time) * 1000 / speed);
        const id = setTimeout(() => playNote({ ...note, duration: note.duration / speed }), delayMs);
        holdTimersRef.current.push(id);
      });
    }
  };

  const handleHoldBeat = (notes: ParsedNote[]) => {
    const speed = speedRef.current;
    notes.forEach(note => playNote({ ...note, duration: note.duration / speed }));
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

  const handleExitGame = () => {
    playbackStop();
    setIsExiting(true);
    setTimeout(() => {
      setPickedResult(null);
      setIsExiting(false);
    }, 500);
  };

  const handlePlaySong = async (id: string) => {
    try {
      setIsLoadingFiles(true);
      const res = await fetch(`${import.meta.env.BASE_URL}songs/${encodeURIComponent(id)}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ptJson = await res.json();

      const catalogEntry = songCatalog.find(s => s.id === id);
      const result = buildResultFromPianoTilesSong(ptJson, 0, id, [0, 1], catalogEntry as any);

      // Extract unique instruments required by this song, default to piano just in case
      const requiredInstruments = Array.from(new Set(result.notes.map(n => n.instrument || 'piano')));
      if (requiredInstruments.length === 0) requiredInstruments.push('piano');

      await loadInstruments(requiredInstruments);

      handleSongSelect(result);
    } catch (err) {
      console.error('Failed to load song:', err);
      alert('Failed to load song: ' + id);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const isGameReady = pickedResult !== null && !isExiting;

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#000', overflow: 'hidden' }}>
      <div className="app-container" style={{ position: 'relative', flex: 1, maxWidth: 'min(1024px, 75vh)', margin: '0 auto', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: '#fff', boxShadow: '0 0 20px rgba(0,0,0,0.5)' }}>

      {/* Game Board (Slides in from Right, Slides out to Right) */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 1,
        background: '#000',
        transform: isGameReady ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)',
      }}>
        {pickedResult && (
          useCanvas ? (
            <CanvasGameBoard
              result={pickedResult}
              onPlayNote={handleTileTap}
              onHoldRelease={handleHoldRelease}
              onExit={handleExitGame}
            />
          ) : (
            <GameBoard
              result={pickedResult}
              onPlayNote={handleTileTap}
              onHoldRelease={handleHoldRelease}
              onHoldBeat={handleHoldBeat}
              onExit={handleExitGame}
            />
          )
        )}
      </div>

      {/* Song Selection Screen (Top Layer sliding off to the Left) */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 2,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: '#fff',
        transform: isGameReady ? 'translateX(-100%)' : 'translateX(0)',
        transition: 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)',
        pointerEvents: isGameReady || isLoadingFiles ? 'none' : 'auto',
        boxShadow: isGameReady ? 'none' : '0 0 20px rgba(0,0,0,0.5)',
      }}>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          
          {isLoadingFiles && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 10,
              backgroundColor: 'rgba(255, 255, 255, 0.8)',
              display: 'flex', flexDirection: 'column',
              justifyContent: 'center', alignItems: 'center',
              backdropFilter: 'blur(4px)'
            }}>
              <div style={{ 
                width: '40px', height: '40px', 
                border: '4px solid rgba(0,0,0,0.1)',
                borderLeftColor: '#3498db',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              <div style={{ marginTop: '16px', fontFamily: 'Arial', fontWeight: 'bold', color: '#555' }}>
                Loading Track Assets...
              </div>
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          )}

          <div style={{ padding: '8px 16px', textAlign: 'center', background: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#555' }}>
              <input type="checkbox" checked={useCanvas} onChange={e => setUseCanvas(e.target.checked)} />
              Use Experimental Canvas Engine
            </label>
          </div>
          <SongSelection onPlaySong={handlePlaySong} />
        </div>
      </div>

      </div>
      <TileRendererWidget />
    </div>
  );
}
