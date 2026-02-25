import type { GameTile, MidiParseResult } from '../types/midi';
import { GameTileCard } from './GameTileCard';
import { useGameBoard } from '../hooks/useGameBoard';
import { useAutoScroll } from '../hooks/useAutoScroll';

interface Props {
  result: MidiParseResult;
  onPlayNote: (tile: GameTile) => void;
}

const LANE_COUNT = 4;
const PX_PER_SEC = 180; // scroll speed — decoupled from tile positioning
const VIEWPORT_H = 600; // approximation — matches CSS height

function groupByLane(tiles: GameTile[]): Map<number, GameTile[]> {
  const map = new Map<number, GameTile[]>();
  for (let i = 0; i < LANE_COUNT; i++) map.set(i, []);
  for (const tile of tiles) map.get(tile.lane)?.push(tile);
  return map;
}

export function GameBoard({ result, onPlayNote }: Props) {
  const { tappedIds, tapTile, scrollRef, reset: resetBoard } = useGameBoard(onPlayNote);

  const { tiles, info, totalHeight } = result;
  const byLane = groupByLane(tiles);

  const { isPlaying, toggle, reset: resetScroll } = useAutoScroll(scrollRef, {
    pixelsPerSecond: PX_PER_SEC,
    totalHeight,
    viewportHeight: VIEWPORT_H,
  });

  const handleReset = () => {
    resetScroll();
    resetBoard();
  };

  return (
    <div className="game-board">

      {/* Top bar */}
      <div className="game-board__topbar">
        <span className="game-board__song">{info.name}</span>
        <span className="game-board__score">
          {tappedIds.size}<span>/{tiles.length}</span>
        </span>
        <div className="game-board__controls">
          <button
            className={`game-board__play-btn ${isPlaying ? 'game-board__play-btn--playing' : ''}`}
            onClick={toggle}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button className="btn-ghost btn-ghost--xs" onClick={handleReset} title="Restart">
            ↺
          </button>
        </div>
      </div>

      {/* Viewport */}
      <div className="game-board__viewport" ref={scrollRef}>
        <div className="game-board__canvas" style={{ height: totalHeight }}>

          {/* Lane columns */}
          <div className="game-board__lanes">
            {Array.from({ length: LANE_COUNT }).map((_, i) => (
              <div key={i} className="game-board__lane" />
            ))}
          </div>

          {/* Tiles */}
          {Array.from(byLane.entries()).map(([laneIndex, laneTiles]) => (
            <div
              key={laneIndex}
              className={`game-board__tile-lane game-board__tile-lane--${laneIndex}`}
            >
              {laneTiles.map(tile => (
                <GameTileCard
                  key={tile.id}
                  tile={tile}
                  tapped={tappedIds.has(tile.id)}
                  onTap={tapTile}
                />
              ))}
            </div>
          ))}

        </div>
      </div>

      {/* Legend */}
      <div className="game-board__legend">
        <span>{isPlaying ? 'playing…' : 'paused'}</span>
        <span>{info.bpm} BPM · {PX_PER_SEC}px/s</span>
      </div>

    </div>
  );
}
