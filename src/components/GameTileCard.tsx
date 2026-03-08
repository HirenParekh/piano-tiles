import type { GameTile } from '../types/midi';

interface Props {
  tile: GameTile;
  tapped: boolean;
  scaleRatio?: number;
  onTap: (tile: GameTile) => void;
}

export function GameTileCard({ tile, tapped, scaleRatio = 1, onTap }: Props) {
  const noteNum = tile.noteIndices[0];
  const startS = tile.note.time.toFixed(3);
  const endS = (tile.note.time + tile.note.duration).toFixed(3);
  const durationMs = Math.round(tile.note.duration * 1000);
  return (
    <div
      className={`game-tile ${tapped ? 'game-tile--tapped' : ''}`}
      style={{ top: tile.top * scaleRatio, height: tile.height * scaleRatio }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onTap(tile);
      }}
      title={`#${noteNum} · ${tile.note.name} · ${startS}s → ${endS}s · ${durationMs}ms`}
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
