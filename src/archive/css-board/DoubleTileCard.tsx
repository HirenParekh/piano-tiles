import { memo } from 'react';
import type { Tile } from '../../types/track';

interface Props {
  tile: Tile;
  onTap: (tile: Tile) => void;
  style?: React.CSSProperties;
  className?: string;
}

export const DoubleTileCard = memo(function DoubleTileCard({ tile, onTap, style, className = '' }: Props) {
  return (
    <div
      className={`game-tile game-tile--double ${className}`}
      data-tile-id={tile.id}
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
});
