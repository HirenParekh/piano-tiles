import type { Tile } from '../types/track';

interface Props {
  tile: Tile;
  tapped: boolean;
  onTap: (tile: Tile) => void;
  onRelease?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

export function HoldTileCard({ tile, tapped, onTap, onRelease, style, className = '' }: Props) {
  const primaryNote = tile.notes[0];
  const lastNote = tile.notes[tile.notes.length - 1];
  const totalDuration = lastNote.time + lastNote.duration - primaryNote.time;
  const totalMs = Math.round(totalDuration * 1000);
  const startS = primaryNote.time.toFixed(3);
  const endS = (lastNote.time + lastNote.duration).toFixed(3);
  const noteNames = tile.notes.map(n => n.name).join('+');

  return (
    <div
      className={`game-tile game-tile--hold ${tapped ? 'game-tile--tapped' : ''} ${className}`}
      style={{ ...style }}
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
        <span>{tile.notes[0].pt2Notation ?? tile.notes[0].name}</span>
        {tile.notes.slice(1).map((note, ni) => (
          <span key={ni} style={{ opacity: 0.7 }}>{note.pt2Notation ?? note.name}</span>
        ))}
      </span>
    </div>
  );
}
