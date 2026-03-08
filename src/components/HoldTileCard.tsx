import type { GameTile } from '../types/midi';

interface Props {
  tile: GameTile;
  tapped: boolean;
  scaleRatio?: number;
  onTap: (tile: GameTile) => void;
  onRelease?: () => void;
}

export function HoldTileCard({ tile, tapped, scaleRatio = 1, onTap, onRelease }: Props) {
  const primaryNote = tile.note;
  const lastNote = tile.notes[tile.notes.length - 1];
  const totalDuration = lastNote.time + lastNote.duration - primaryNote.time;
  const totalMs = Math.round(totalDuration * 1000);
  const startS = primaryNote.time.toFixed(3);
  const endS = (lastNote.time + lastNote.duration).toFixed(3);
  const noteNames = tile.notes.map(n => n.name).join('+');

  return (
    <div
      className={`game-tile game-tile--hold ${tapped ? 'game-tile--tapped' : ''}`}
      style={{ top: tile.top * scaleRatio, height: tile.height * scaleRatio }}
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
        <span>{tile.note.pt2Notation ?? tile.note.name}</span>
        {tile.notes.slice(1).map((note, ni) => (
          <span key={ni} style={{ opacity: 0.7 }}>{note.pt2Notation ?? note.name}</span>
        ))}
      </span>
    </div>
  );
}
