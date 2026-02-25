import type { TrackMeta } from '../types/midi';

interface Props {
  tracks: TrackMeta[];
  selectedTracks: Set<number>;
  onToggle: (index: number) => void;
  onConfirm: () => void;
  onReset: () => void;
}

const CATEGORY_BADGE: Record<string, { label: string; className: string }> = {
  piano:    { label: '🎹 Piano',           className: 'badge badge--piano' },
  keyboard: { label: '🎛 Keyboard/Organ',  className: 'badge badge--keyboard' },
  other:    { label: '🎵 Other',           className: 'badge badge--other' },
};

export function TrackSelector({ tracks, selectedTracks, onToggle, onConfirm, onReset }: Props) {
  const selectedCount = selectedTracks.size;
  const selectedNotes = [...selectedTracks].reduce(
    (sum, i) => sum + (tracks[i]?.noteCount ?? 0), 0
  );

  return (
    <div className="track-selector">
      <div className="track-selector__header">
        <span className="panel-title">Select Tracks</span>
        <span className="hint">Piano/keyboard tracks are auto-selected · click any row to toggle</span>
      </div>

      <ul className="track-list">
        {tracks.map((track) => {
          const isSelected = selectedTracks.has(track.index);
          const badge = CATEGORY_BADGE[track.category] ?? CATEGORY_BADGE.other;

          return (
            <li
              key={track.index}
              className={[
                'track-row',
                isSelected ? 'track-row--selected' : '',
                isSelected && track.autoSelected ? 'track-row--auto' : '',
              ].join(' ').trim()}
              onClick={() => onToggle(track.index)}
            >
              <div className="track-row__checkbox">
                {isSelected ? '✓' : ''}
              </div>
              <div className="track-row__info">
                <div className="track-row__name">{track.name}</div>
                <div className="track-row__meta">
                  <span>{track.noteCount} notes</span>
                  <span>Ch {track.channel + 1}</span>
                  <span>{track.instrName}</span>
                  <span className={badge.className}>{badge.label}</span>
                  {track.autoSelected && (
                    <span className="auto-tag">● auto-detected</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="track-selector__footer">
        <span className="track-selector__summary">
          <strong>{selectedCount}</strong> of {tracks.length} tracks
          &nbsp;·&nbsp;
          <strong>{selectedNotes.toLocaleString()}</strong> notes
        </span>
        <div className="btn-row">
          <button className="btn-ghost" onClick={onReset}>← Load Another</button>
          <button
            className="btn-primary"
            onClick={onConfirm}
            disabled={selectedCount === 0}
          >
            Extract Notes →
          </button>
        </div>
      </div>
    </div>
  );
}
