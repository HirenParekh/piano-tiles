import type { Tile } from '../types/track';

interface Props {
  tile: Tile;
  tapped: boolean;
  onTap: (tile: Tile) => void;
  style?: React.CSSProperties;
  className?: string;
}

export function GameTileCard({ tile, tapped, onTap, style, className = '' }: Props) {
  const noteNum = tile.noteIndices[0];
  const startS = tile.notes[0].time.toFixed(3);
  const endS = (tile.notes[0].time + tile.notes[0].duration).toFixed(3);
  const durationMs = Math.round(tile.notes[0].duration * 1000);
  return (
    <div
      className={`game-tile ${tapped ? 'game-tile--tapped' : ''} ${className}`}
      style={{ ...style }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onTap(tile);
      }}
      title={`#${noteNum} · ${tile.notes[0].name} · ${startS}s → ${endS}s · ${durationMs}ms`}
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
