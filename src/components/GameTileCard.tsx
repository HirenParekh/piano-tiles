import type { GameTile } from '../types/midi';

interface Props {
  tile: GameTile;
  tapped: boolean;
  onTap: (tile: GameTile) => void;
}

export function GameTileCard({ tile, tapped, onTap }: Props) {
  const noteNum    = tile.noteIndices[0];
  const startS     = tile.note.time.toFixed(3);
  const endS       = (tile.note.time + tile.note.duration).toFixed(3);
  const durationMs = Math.round(tile.note.duration * 1000);
  return (
    <div
      className={`game-tile ${tapped ? 'game-tile--tapped' : ''}`}
      style={{ top: tile.top, height: tile.height }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onTap(tile);
      }}
      title={`#${noteNum} · ${tile.note.name} · ${startS}s → ${endS}s · ${durationMs}ms`}
    >
      <span className="game-tile__label">
        <span>#{noteNum}</span>
        <span>{startS}s → {endS}s</span>
        <span>{durationMs}ms</span>
      </span>
    </div>
  );
}
