import { useEffect, useMemo, useRef, useState } from 'react';
import { useSynth } from './hooks/useSynth';
import { usePreload } from './hooks/usePreload';
import { usePlayback } from './hooks/usePlayback';
import { useTileAudio } from './hooks/useTileAudio';
import { HomeScreen } from './components/HomeScreen';
import { SongSelection } from './components/SongSelection';
import { GameBoard } from './components/GameBoard';
import type { GameBoardSkin } from './components/GameBoard';
import { CanvasGameBoard } from './components/CanvasGameBoard';
import { PhaserGameBoard } from './components/PhaserGameBoard';
import type { MidiParseResult } from './types/midi';
import { buildResultFromPianoTilesSong } from './utils/pianoTilesParser';
import songCatalog from './songCatalog.json';
import './styles/main.scss';
import { TileRendererWidget } from './components/TileRendererWidget';
import { HoldTileLayersDebug } from './components/HoldTileLayersDebug';

type AppScreen = 'home' | 'selection' | 'game';
export default function App() {
  // Show dev-only UI (Debug Board, canvas toggle, TileRendererWidget) only when
  // the URL contains ?ui=dev_mode. This keeps the prod experience clean without
  // requiring a separate build flag.
  const isDevMode = new URLSearchParams(window.location.search).get('ui') === 'dev_mode';

  const { loadInstruments, resolveNotes, resolveChords, playNote, attackNote, releaseNote, playNoteScheduled, getAudioTime, resumeContext } = useSynth();

  const preload = usePreload(loadInstruments);

  const [screen, setScreen] = useState<AppScreen>('home');

  // Song picked from the Library tab
  const [pickedResult, setPickedResult] = useState<MidiParseResult | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const [useCanvas, setUseCanvas] = useState(false);
  const [usePhaser, setUsePhaser] = useState(true);
  const [boardSkin, setBoardSkin] = useState<GameBoardSkin>('classic');
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isWidgetOpen, setIsWidgetOpen] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false); // For speed selector dropdown
  const [showTimeScaleMenu, setShowTimeScaleMenu] = useState(false); // For animation slow-mo dropdown
  const [timeScale, setTimeScale] = useState(1);

  const playbackNotes = useMemo(
    () => pickedResult?.notes ?? [],
    [pickedResult],
  );
  const { stop: playbackStop } = usePlayback(
    playbackNotes,
    pickedResult?.info.durationSeconds ?? 0,
    playNoteScheduled
  );

  const speedRef = useRef(1);

  // Keep speedRef synced with speedMultiplier so audio playback reacts to speed changes
  useEffect(() => {
    speedRef.current = speedMultiplier;
  }, [speedMultiplier]);

  const { handleTileTap, handleHoldBeat, handleHoldRelease } = useTileAudio({
    playNote,
    attackNote,
    releaseNote,
    resumeContext,
    getSpeed: () => speedRef.current,
    playNoteScheduled,
    getAudioTime,
  });

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
      setScreen('selection');
    }, 500);
  };

  useEffect(() => {
    if (preload.isComplete && screen === 'home') {
      setScreen('selection');
    }
  }, [preload.isComplete, screen]);

  const handlePlaySong = async (id: string) => {
    try {
      setIsLoadingFiles(true);
      // Prime the Web Audio context on this user gesture so the first note
      // plays with no latency when the player taps START on the board.
      resumeContext();
      const base = import.meta.env.BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${base}/songs/${encodeURIComponent(id)}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ptJson = await res.json();

      const catalogEntry = songCatalog.find(s => s.id === id);
      const result = buildResultFromPianoTilesSong(ptJson, 0, id, [0, 1], catalogEntry as any);

      // Extract unique instruments required by this song, default to piano just in case
      const requiredInstruments = Array.from(new Set(result.notes.map(n => n.instrument || 'piano')));
      if (requiredInstruments.length === 0) requiredInstruments.push('piano');

      if (!usePhaser) {
        await loadInstruments(requiredInstruments);
        resolveNotes(result.notes);
        // @ts-ignore - speedMultiplier parameter correctly added to useSynth
        await resolveChords(result.tiles, speedMultiplier);
      }

      handleSongSelect(result);
      setScreen('game');
    } catch (err) {
      console.error('Failed to load song:', err);
      alert('Failed to load song: ' + id);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const isGameReady = screen === 'game' && !isExiting;

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#000', overflow: 'hidden' }}>
      <div className="app-container" style={{ position: 'relative', flex: 1, maxWidth: 'min(1024px, 75vh)', margin: '0 auto', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: '#fff', boxShadow: '0 0 20px rgba(0,0,0,0.5)' }}>

        {/* Floating Speed Selectors */}
        {screen === 'selection' && (
          <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 90, display: 'flex', gap: '8px' }}>

            {/* Engine TimeScale (Animation SlowMo) */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowTimeScaleMenu(!showTimeScaleMenu)}
                style={{
                  padding: '8px 12px', borderRadius: '8px', background: 'rgba(231, 76, 60, 0.9)',
                  color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
                }}
              >
                Engine: {timeScale}x ▾
              </button>
              {showTimeScaleMenu && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '8px', background: '#fff',
                  padding: '12px', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                  display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '150px'
                }}>
                  <div style={{ fontSize: '12px', color: '#888', fontWeight: 'bold' }}>Phaser Time Scale</div>
                  {[0.1, 0.25, 0.5, 1].map(v => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', color: '#333', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        checked={timeScale === v}
                        onChange={() => { setTimeScale(v); setShowTimeScaleMenu(false); }}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      {v}x (SlowMo)
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Song Speed */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                style={{
                  padding: '8px 12px', borderRadius: '8px', background: 'rgba(52, 152, 219, 0.9)',
                  color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
                }}
              >
                Speed: {speedMultiplier}x ▾
              </button>
              {showSpeedMenu && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '8px', background: '#fff',
                  padding: '12px', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                  display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '120px'
                }}>
                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5].map(v => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', color: '#333', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        checked={speedMultiplier === v}
                        onChange={() => { setSpeedMultiplier(v); setShowSpeedMenu(false); }}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      {v}x Song Speed
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Game Board — z:1, slides in from right */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 1,
          background: '#000',
          transform: isGameReady ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)',
        }}>
          {pickedResult && (
            usePhaser ? (
                <PhaserGameBoard
                  result={pickedResult}
                  onExit={handleExitGame}
                  speedMultiplier={speedMultiplier}
                  debug={boardSkin === 'debug'}
                  timeScale={timeScale}
                  isDevMode={isDevMode}
                />
            ) : useCanvas ? (
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
                skin={boardSkin}
                speedMultiplier={speedMultiplier}
              />
            )
          )}
        </div>

        {/* Song Selection — z:2, slides left when game starts */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: '#fff',
          transform: isGameReady ? 'translateX(-100%)' : 'translateX(0)',
          transition: 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)',
          pointerEvents: screen === 'selection' && !isLoadingFiles ? 'auto' : 'none',
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

            {/* Dev toolbar — only visible with ?ui=dev_mode in the URL */}
            {isDevMode && (
              <div style={{ padding: '8px 16px', background: '#f5f5f5', borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'center', gap: '24px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#555' }}>
                  <input type="checkbox" checked={useCanvas} onChange={e => setUseCanvas(e.target.checked)} />
                  Canvas
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#555' }}>
                  <input type="checkbox" checked={!usePhaser} onChange={e => setUsePhaser(!e.target.checked)} />
                  CSS Board (legacy)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#555' }}>
                  <input type="checkbox" checked={boardSkin === 'debug'} onChange={e => setBoardSkin(e.target.checked ? 'debug' : 'classic')} />
                  Debug Tiles
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#555' }}>
                  {[0.25, 0.5, 0.75, 1.5].map(v => (
                    <button
                      key={v}
                      onClick={() => setSpeedMultiplier(speedMultiplier === v ? 1 : v)}
                      style={{
                        padding: '2px 10px', borderRadius: '12px', border: '1px solid #bbb',
                        background: speedMultiplier === v ? '#333' : '#fff',
                        color: speedMultiplier === v ? '#fff' : '#555',
                        cursor: 'pointer', fontSize: '13px', fontFamily: 'Arial, sans-serif',
                      }}
                    >
                      {v * 100}%
                    </button>
                  ))}
                </div>
              </div>
            )}
            <SongSelection onPlaySong={handlePlaySong} />
          </div>
        </div>

        {/* Home Screen — z:3, slides left after PLAY is clicked */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 3,
          transform: screen === 'home' ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)',
          pointerEvents: screen === 'home' ? 'auto' : 'none',
        }}>
          <HomeScreen
            progress={preload.progress}
            statusMessage={preload.statusMessage}
            error={preload.error}
            onRetry={preload.retry}
          />
        </div>

      </div>

      {/* Dev widget toggle + sliding panel — only rendered with ?ui=dev_mode */}
      {isDevMode && (
        <>
          <button
            onClick={() => setIsWidgetOpen(o => !o)}
            style={{
              position: 'fixed', right: isWidgetOpen ? '95vw' : 0, top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 100,
              background: '#1a1a2e', color: '#00cfff',
              border: '1px solid rgba(0,207,255,0.4)',
              borderRight: 'none',
              borderRadius: '6px 0 0 6px',
              padding: '12px 6px', cursor: 'pointer', writingMode: 'vertical-rl',
              fontSize: '11px', fontFamily: 'monospace', letterSpacing: '0.1em',
              transition: 'right 0.35s cubic-bezier(0.25, 1, 0.5, 1)',
            }}
          >
            {isWidgetOpen ? '▶ CLOSE' : '◀ DEV'}
          </button>

          <div style={{
            position: 'fixed', top: 0, right: 0, width: '95vw', height: '100vh',
            zIndex: 99,
            transform: isWidgetOpen ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.35s cubic-bezier(0.25, ' + (1) + ', 0.5, 1)',
            pointerEvents: isWidgetOpen ? 'auto' : 'none',
            background: '#0d0d1a',
            borderLeft: '1px solid rgba(0,207,255,0.25)',
            boxShadow: isWidgetOpen ? '-8px 0 32px rgba(0,0,0,0.6)' : 'none',
            overflowY: 'auto',
          }}>
            <TileRendererWidget />
            <HoldTileLayersDebug />
          </div>
        </>
      )}
    </div>
  );
}
