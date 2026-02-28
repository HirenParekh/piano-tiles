import type { GameTile } from '../types/midi';

interface Props {
  tile: GameTile;
  tapped: boolean;
  onTap: (tile: GameTile) => void;
  onRelease?: () => void;
}

export function HoldTileCard({ tile, tapped, onTap, onRelease }: Props) {
  const primaryNote = tile.note;
  const lastNote    = tile.notes[tile.notes.length - 1];
  const totalDuration = lastNote.time + lastNote.duration - primaryNote.time;
  const totalMs     = Math.round(totalDuration * 1000);
  const startS      = primaryNote.time.toFixed(3);
  const endS        = (lastNote.time + lastNote.duration).toFixed(3);
  const noteNames   = tile.notes.map(n => n.name).join('+');

  // Intermediate notes (not the first — these get a dot)
  const intermediateNotes = tile.notes.slice(1);

  return (
    <div
      className={`game-tile game-tile--hold ${tapped ? 'game-tile--tapped' : ''}`}
      style={{ top: tile.top, height: tile.height }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onTap(tile);
      }}
      onPointerUp={() => onRelease?.()}
      onPointerCancel={() => onRelease?.()}
      title={`#${tile.noteIndices[0]} · ${noteNames} · ${startS}s → ${endS}s · ${totalMs}ms`}
    >
      <span className="game-tile__label">
        <span>#{tile.noteIndices[0]} · {totalMs}ms</span>
        {tile.notes.map((note, ni) => {
          const nStartS  = note.time.toFixed(3);
          const nEndS    = (note.time + note.duration).toFixed(3);
          const nMs      = Math.round(note.duration * 1000);
          const noteNum  = tile.noteIndices[ni];
          return (
            <span key={ni} style={{ opacity: 0.7 }}>
              #{noteNum} {note.name} {nStartS}→{nEndS} ({nMs}ms)
            </span>
          );
        })}
      </span>

      {/* White dot for each intermediate note, positioned proportionally */}
      {intermediateNotes.map((note) => {
        // Fraction of tile from the BOTTOM (tile bottom = primary note start)
        const offsetRatio = (note.time - primaryNote.time) / totalDuration;
        // Convert to CSS top from tile's top edge: bottom is (1 - 0) = 100%
        const dotTop = (1 - offsetRatio) * tile.height - 5; // -5 centers the 10px dot
        return (
          <div
            key={`${note.midi}-${note.time}`}
            className="game-tile__hold-dot"
            style={{ top: dotTop }}
            title={`${note.name} · ${note.time.toFixed(3)}s`}
          />
        );
      })}
    </div>
  );
}
