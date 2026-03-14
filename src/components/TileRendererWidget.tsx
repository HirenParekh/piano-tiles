import { useState, useMemo, useRef, useEffect } from 'react';
import { buildResultFromPianoTilesSong } from '../utils/pianoTilesParser';
import { buildTrackFromTiles } from '../utils/trackBuilder';
import { GameTileCard } from './GameTileCard';
import { HoldTileCard } from './HoldTileCard';
import type { Tile } from '../types/track';
import type { ParsedNote } from '../types/midi';
import { MIN_HEIGHT } from '../utils/tileBuilder';
import { useSynth } from '../hooks/useSynth';

const defaultJson = `{
  "baseBpm": 100,
  "musics": [
    {
      "id": 0,
      "bpm": 100,
      "baseBeats": 0.5,
      "scores": [
        "e3[L],e3[L],e3[K],e3[L],e3[L],e3[K];e3[L],g3[L],c3[L],d3[L],e3[J];f3[L],f3[L],f3[K],f3[L],e3[L],e3[K];e3[L],d3[L],d3[L],c3[L],d3[K],g3[K];e3[L],e3[L],e3[K],e3[L],e3[L],e3[K];e3[L],g3[L],c3[L],d3[L],e3[J];f3[L],f3[L],f3[K],f3[L],e3[L],e3[K];g3[L],g3[L],f3[L],d3[L],c3[J];a3[L],g3[L],f3[L],d3[L],c3[J];",
        "c1[L],e1[L],g[L],e1[L],c1[L],e1[L],g[L],e1[L];c1[L],e1[L],g[L],e1[L],c1[L],e1[L],g[L],e1[L];d1[L],f1[L],b[L],f1[L],d1[L],f1[L],c1[L],e1[L];d1[L],g1[L],g[L],g1[L],b[L],f1[L],g[L],f1[L];c1[L],e1[L],g[L],e1[L],c1[L],e1[L],g[L],e1[L];c1[L],e1[L],g[L],e1[L],c1[L],e1[L],g[L],e1[L];d1[L],f1[L],g[L],f1[L],b[L],g1[L],c1[L],g1[L];b[L],g1[L],g[L],g1[L],c1[L],e1[L],c1[L],U;b[L],f1[L],g[L],f1[L],c1[L],e1[L],c1[K];"
      ]
    }
  ]
}`;

export function TileRendererWidget() {
  const [jsonStr, setJsonStr] = useState(defaultJson);

  const { trackData, bassTrackData, error } = useMemo(() => {
    try {
      const parsedJson = JSON.parse(jsonStr);

      const result = buildResultFromPianoTilesSong(parsedJson, 0, 'Sandbox', [0, 1]);
      const track = buildTrackFromTiles(result.tiles);

      // Extract isolated bass version
      const bassResult = buildResultFromPianoTilesSong(parsedJson, 0, 'Sandbox Bass', [1]);
      const bassTrack = buildTrackFromTiles(bassResult.tiles);

      return { trackData: track, bassTrackData: bassTrack, error: null };
    } catch (err: any) {
      return { trackData: null, bassTrackData: null, error: err.message };
    }
  }, [jsonStr]);

  const { loadInstruments, playNote, attackNote, releaseNote, resumeContext } = useSynth();
  const [tappedIds, setTappedIds] = useState<Set<string>>(new Set());
  const holdTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const heldNoteRef = useRef<ParsedNote | null>(null);

  useEffect(() => {
    // Ensure piano instrument is loaded as default for the sandbox
    loadInstruments(['piano']);
  }, [loadInstruments]);

  const handleTap = async (tile: Tile) => {
    await resumeContext();

    // flash the visually tapped state
    setTappedIds(prev => {
      const next = new Set(prev);
      next.add(tile.id);
      return next;
    });

    // clear the visual tapped state so it springs back visually
    setTimeout(() => {
      setTappedIds(prev => {
        const next = new Set(prev);
        next.delete(tile.id);
        return next;
      });
    }, 150);

    holdTimersRef.current.forEach(clearTimeout);
    holdTimersRef.current = [];

    const isHold = tile.type === 'HOLD';
    const primaryNote = tile.notes[0];

    if (!primaryNote) return;

    if (isHold) {
      attackNote({ ...primaryNote });
      heldNoteRef.current = primaryNote;
      // Merged notes are played position-based via onNotePlay — no timers needed
    } else {
      playNote({ ...primaryNote });
      tile.notes.slice(1).forEach((note) => {
        const delayMs = Math.round((note.time - primaryNote.time) * 1000);
        const id = setTimeout(() => playNote({ ...note }), delayMs);
        holdTimersRef.current.push(id);
      });
    }
  };

  const handleNotePlay = (notes: ParsedNote[]) => {
    notes.forEach(note => playNote({ ...note }));
  };

  const handleHoldRelease = () => {
    if (heldNoteRef.current) {
      releaseNote(heldNoteRef.current);
      heldNoteRef.current = null;
    }
    holdTimersRef.current.forEach(clearTimeout);
    holdTimersRef.current = [];
  };

  return (
    <div style={{
      width: '900px',
      height: '100%',
      backgroundColor: '#f5f5f5',
      borderLeft: '1px solid #ddd',
      display: 'flex',
      flexDirection: 'row',
      color: '#333',
      boxSizing: 'border-box',
      zIndex: 10,
      fontFamily: 'sans-serif'
    }}>
      {/* Editor Panel */}
      <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', borderRight: '1px solid #ddd' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#111' }}>JSON Sandbox</h3>
        <textarea
          value={jsonStr}
          onChange={e => setJsonStr(e.target.value)}
          spellCheck={false}
          style={{
            flex: 1,
            padding: '12px',
            fontFamily: 'monospace',
            fontSize: '13px',
            background: '#fff',
            color: '#000',
            border: '1px solid #ccc',
            borderRadius: '4px',
            resize: 'none',
            whiteSpace: 'pre',
            overflow: 'auto',
            lineHeight: '1.5'
          }}
        />
        {error && (
          <div style={{ marginTop: '16px', color: '#d32f2f', padding: '12px', background: '#ffebee', borderRadius: '4px' }}>
            Error: {error}
          </div>
        )}
      </div>

      {/* Combined Boards Panel */}
      <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#111', width: '240px', textAlign: 'center' }}>Merged (Melody + Bass)</h3>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#111', width: '240px', textAlign: 'center' }}>Raw Bass Track</h3>
        </div>

        {trackData && bassTrackData ? (
          <div
            onContextMenu={(e) => e.preventDefault()}
            style={{
              flex: 1, overflowY: 'auto', background: '#fff', border: '1px solid #ddd',
              borderRadius: '8px', display: 'flex', flexDirection: 'column-reverse', padding: '16px'
            }}>
            <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-around', width: '100%', maxWidth: '600px', margin: '0 auto' }}>

              {/* Left Board (Merged) */}
              <div style={{ display: 'flex', flexDirection: 'column-reverse', width: '240px', position: 'relative' }}>
                {trackData.cards.map((card, i) => {
                  const cardH = card.span * MIN_HEIGHT;
                  if (card.type === 'START' || card.type === 'FINISH' || card.type === 'INFO') return null;
                  if (card.type === 'TILE') {
                    const tc = card as any;
                    return (
                      <div key={i} style={{ height: cardH, width: '100%', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: `repeat(${tc.span}, 1fr)`, borderBottom: '1px solid #eaeaea', borderTop: '1px solid #eaeaea', position: 'relative' }}>
                        <div style={{ gridColumn: '1 / -1', gridRow: '1 / -1', display: 'flex', pointerEvents: 'none', position: 'absolute', inset: 0 }}>
                          <div style={{ flex: 1, borderRight: '1px dashed #eaeaea' }} />
                          <div style={{ flex: 1, borderRight: '1px dashed #eaeaea' }} />
                          <div style={{ flex: 1, borderRight: '1px dashed #eaeaea' }} />
                          <div style={{ flex: 1 }} />
                        </div>
                        {tc.tiles.map((tile: Tile) => (
                          tile.type === 'HOLD' ? (
                            <HoldTileCard key={tile.id} tile={tile} tapped={tappedIds.has(tile.id)} onTap={handleTap} onRelease={handleHoldRelease} onNotePlay={handleNotePlay} className="" style={{ top: 'auto', left: 'auto', bottom: 'auto', position: 'relative', height: '100%', width: '100%', margin: 0, padding: 0, gridColumn: tile.lane + 1, gridRow: `${tc.span - tile.rowStart - tile.rowSpan + 1} / span ${tile.rowSpan}` }} />
                          ) : (
                            <GameTileCard key={tile.id} tile={tile} tapped={tappedIds.has(tile.id)} onTap={handleTap} className="" style={{ top: 'auto', left: 'auto', bottom: 'auto', position: 'relative', height: '100%', width: '100%', margin: 0, padding: 0, gridColumn: tile.lane + 1, gridRow: `${tc.span - tile.rowStart - tile.rowSpan + 1} / span ${tile.rowSpan}` }} />
                          )
                        ))}
                      </div>
                    );
                  }
                  return <div key={`empty-${i}`} style={{ height: cardH, width: '100%', borderBottom: '1px dashed #eaeaea' }} />;
                })}
              </div>

              {/* Right Board (Raw Bass) */}
              <div style={{ display: 'flex', flexDirection: 'column-reverse', width: '240px', position: 'relative', borderLeft: '1px solid #ff0000ff' }}>
                {bassTrackData.cards.map((card, i) => {
                  const cardH = card.span * MIN_HEIGHT;
                  if (card.type === 'START' || card.type === 'FINISH' || card.type === 'INFO') return null;
                  if (card.type === 'TILE') {
                    const tc = card as any;
                    return (
                      <div key={i} style={{ height: cardH, width: '100%', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: `repeat(${tc.span}, 1fr)`, borderBottom: '1px solid #eaeaea', borderTop: '1px solid #eaeaea', position: 'relative' }}>
                        <div style={{ gridColumn: '1 / -1', gridRow: '1 / -1', display: 'flex', pointerEvents: 'none', position: 'absolute', inset: 0 }}>
                          <div style={{ flex: 1, borderRight: '1px dashed #eaeaea' }} />
                          <div style={{ flex: 1, borderRight: '1px dashed #eaeaea' }} />
                          <div style={{ flex: 1, borderRight: '1px dashed #eaeaea' }} />
                          <div style={{ flex: 1 }} />
                        </div>
                        {tc.tiles.map((tile: Tile) => (
                          tile.type === 'HOLD' ? (
                            <HoldTileCard key={tile.id} tile={tile} tapped={tappedIds.has(tile.id)} onTap={handleTap} onRelease={handleHoldRelease} onNotePlay={handleNotePlay} className="" style={{ top: 'auto', left: 'auto', bottom: 'auto', position: 'relative', height: '100%', width: '100%', margin: 0, padding: 0, gridColumn: tile.lane + 1, gridRow: `${tc.span - tile.rowStart - tile.rowSpan + 1} / span ${tile.rowSpan}` }} />
                          ) : (
                            <GameTileCard key={tile.id} tile={tile} tapped={tappedIds.has(tile.id)} onTap={handleTap} className="" style={{ top: 'auto', left: 'auto', bottom: 'auto', position: 'relative', height: '100%', width: '100%', margin: 0, padding: 0, gridColumn: tile.lane + 1, gridRow: `${tc.span - tile.rowStart - tile.rowSpan + 1} / span ${tile.rowSpan}` }} />
                          )
                        ))}
                      </div>
                    );
                  }
                  return <div key={`empty-${i}`} style={{ height: cardH, width: '100%', borderBottom: '1px dashed #eaeaea' }} />;
                })}
              </div>

            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
