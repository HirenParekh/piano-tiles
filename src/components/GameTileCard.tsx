import type { GameTile } from '../types/midi';

interface Props {
  tile: GameTile;
  tapped: boolean;
  onTap: (tile: GameTile) => void;
}

export function GameTileCard({ tile, tapped, onTap }: Props) {
  return (
    <div
      className={`game-tile ${tapped ? 'game-tile--tapped' : ''}`}
      style={{ top: tile.top, height: tile.height }}
      onPointerDown={(e) => {
        e.preventDefault();
        onTap(tile);
      }}
      title={`${tile.note.name} — ${tile.note.time.toFixed(2)}s`}
    >
      <span className="game-tile__label">{tile.note.name}</span>
    </div>
  );
}
