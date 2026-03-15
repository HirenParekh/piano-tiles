import type { Tile } from '../types/track';

interface Props {
  tile: Tile;
  tapped: boolean;
  onTap: (tile: Tile) => void;
  style?: React.CSSProperties;
  className?: string;
}

export function DoubleTileCard({ tile, tapped, onTap, style, className = '' }: Props) {
  return (
    <div
      className={`game-tile game-tile--double ${tapped ? 'game-tile--tapped' : ''} ${className}`}
      style={{ ...style }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onTap(tile);
      }}
      title={tile.notes[0].pt2Notation ?? tile.notes[0].name}
    >
      <span className="game-tile__label">
        <span>{tile.notes[0].pt2Notation ?? tile.notes[0].name}</span>
      </span>
    </div>
  );
}
