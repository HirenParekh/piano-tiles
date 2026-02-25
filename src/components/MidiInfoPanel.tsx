import type { MidiInfo, TrackMeta } from '../types/midi';

interface Props {
  info: MidiInfo;
  tracks: TrackMeta[];
  selectedTracks: Set<number>;
  tileCount: number;
  isPlaying: boolean;
  currentTime: number;
  onChangeTrack: () => void;
  onReset: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MidiInfoPanel({
  info, tracks, selectedTracks, tileCount,
  isPlaying, currentTime,
  onChangeTrack, onReset, onPlay, onPause, onStop,
}: Props) {
  const usedTrackNames = [...selectedTracks]
    .map((i) => tracks[i]?.name)
    .filter(Boolean)
    .join(', ');

  const progress = info.durationSeconds > 0
    ? Math.min(100, (currentTime / info.durationSeconds) * 100)
    : 0;

  const stats = [
    { label: 'Song',        value: info.name },
    { label: 'BPM',         value: info.bpm },
    { label: 'Duration',    value: formatDuration(info.durationSeconds) },
    { label: 'Time Sig',    value: `${info.timeSignature[0]}/${info.timeSignature[1]}` },
    { label: 'Tracks Used', value: `${selectedTracks.size} / ${info.trackCount}` },
    { label: 'Tiles',       value: tileCount.toLocaleString() },
  ];

  return (
    <div className="info-panel">
      <div className="panel-header">
        <span className="panel-title">MIDI Loaded</span>
        <div className="btn-row">
          <button className="btn-ghost" onClick={onChangeTrack}>← Change Tracks</button>
          <button className="btn-ghost" onClick={onReset}>Load Another</button>
        </div>
      </div>

      <div className="stats-grid">
        {stats.map(({ label, value }) => (
          <div key={label} className="stat">
            <span className="stat__label">{label}</span>
            <span className="stat__value">{value}</span>
          </div>
        ))}
      </div>

      {/* Playback controls */}
      <div className="info-panel__playback">
        <div className="info-panel__play-controls">
          <button
            className={`info-panel__play-btn${isPlaying ? ' info-panel__play-btn--pause' : ''}`}
            onClick={isPlaying ? onPause : onPlay}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button
            className="info-panel__stop-btn"
            onClick={onStop}
            title="Stop"
          >
            ⏹
          </button>
          <span className="info-panel__playtime">
            {formatDuration(currentTime)} / {formatDuration(info.durationSeconds)}
          </span>
        </div>
        <div className="info-panel__progress">
          <div className="info-panel__progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {usedTrackNames && (
        <p className="info-panel__tracks">Using: {usedTrackNames}</p>
      )}
    </div>
  );
}
