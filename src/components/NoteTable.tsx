import { useState } from 'react';
import type { GameTile } from '../types/midi';

interface Props {
  tiles: GameTile[];
  onTileTap?: (tile: GameTile) => void;
}

const LANE_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
const LANE_LABELS = ['Lane 1', 'Lane 2', 'Lane 3', 'Lane 4'];
const PAGE_SIZE = 40;

export function NoteTable({ tiles, onTileTap }: Props) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(tiles.length / PAGE_SIZE);
  const visible = tiles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="note-table">
      <div className="note-table__header">
        <h2 className="note-table__title">Extracted Notes → Tiles</h2>
        <span className="note-table__count">{tiles.length} tiles total</span>
      </div>

      <div className="note-table__scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Note</th>
              <th>MIDI#</th>
              <th>Time (s)</th>
              <th>Duration</th>
              <th>Velocity</th>
              <th>Lane</th>
              <th>Track</th>
              {onTileTap && <th>Play</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((tile, i) => (
              <tr key={tile.id} className={tile.tapped ? 'tapped' : ''}>
                <td className="muted">{page * PAGE_SIZE + i + 1}</td>
                <td className="note-name">{tile.note.name}</td>
                <td className="muted">{tile.note.midi}</td>
                <td>{tile.note.time.toFixed(3)}</td>
                <td>{tile.note.duration.toFixed(3)}s</td>
                <td>{Math.round(tile.note.velocity * 127)}</td>
                <td>
                  <span
                    className="lane-badge"
                    style={{ background: LANE_COLORS[tile.lane] }}
                  >
                    {LANE_LABELS[tile.lane]}
                  </span>
                </td>
                <td className="muted">{tile.note.trackName}</td>
                {onTileTap && (
                  <td>
                    <button
                      className="play-btn"
                      onClick={() => onTileTap(tile)}
                      title={`Play ${tile.note.name}`}
                    >
                      ▶
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="note-table__pagination">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
            ← Prev
          </button>
          <span>{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
