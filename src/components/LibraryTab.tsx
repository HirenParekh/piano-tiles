import { useState, useMemo, useRef, useEffect } from 'react';
import type { MidiParseResult } from '../types/midi';
import {
  buildResultFromPianoTilesSong,
  type PianoTilesSong,
} from '../utils/pianoTilesParser';

const SONG_MODULES = import.meta.glob(
  '../../PianoTilesJAVA/resources/assets/res/song/*.json',
  { eager: false },
) as Record<string, () => Promise<{ default: unknown }>>;

function pathToName(path: string): string {
  return path.split('/').pop()!.replace(/\.json$/, '');
}

const ALL_SONGS: Array<{ name: string; path: string }> = Object.keys(SONG_MODULES)
  .map(path => ({ name: pathToName(path), path }))
  .sort((a, b) => a.name.localeCompare(b.name));

const DIFF_LABELS = ['Easy', 'Medium', 'Hard', 'Expert'];
const DIFF_COLORS = ['#c8ff00', '#00cfff', '#ff4d6d', '#f39c12'];

interface Props {
  onSelect: (result: MidiParseResult, songName: string) => void;
  currentSongName?: string;
}

const SCORE_LABELS = ['Melody', 'Bass', 'Track 3', 'Track 4'];

export function LibraryTab({ onSelect, currentSongName }: Props) {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedData, setExpandedData] = useState<{
    name: string;
    song: PianoTilesSong;
  } | null>(null);
  const [selectedScores, setSelectedScores] = useState<Set<number>>(new Set([0]));
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ALL_SONGS;
    return ALL_SONGS.filter(s => s.name.toLowerCase().includes(q));
  }, [search]);

  const handleSongClick = async (path: string, name: string) => {
    // Collapse if already expanded
    if (expanded === path) {
      setExpanded(null);
      setExpandedData(null);
      return;
    }
    setSelectedScores(new Set([0])); // reset to melody-only for each new song
    setLoading(path);
    try {
      const mod = await SONG_MODULES[path]();
      const song = (mod as { default: unknown }).default as PianoTilesSong;
      setExpanded(path);
      setExpandedData({ name, song });
    } catch (err) {
      console.error('Failed to load song:', err);
    } finally {
      setLoading(null);
    }
  };

  const toggleScore = (si: number) => {
    setSelectedScores(prev => {
      const next = new Set(prev);
      if (next.has(si) && next.size > 1) next.delete(si); // keep at least one
      else next.add(si);
      return next;
    });
  };

  const handleLoad = (musicIndex: number) => {
    if (!expandedData) return;
    const result = buildResultFromPianoTilesSong(
      expandedData.song,
      musicIndex,
      expandedData.name,
      Array.from(selectedScores),
    );
    onSelect(result, expandedData.name);
  };

  return (
    <div className="library-tab">
      <div className="library-tab__search">
        <input
          ref={searchRef}
          className="library-tab__input"
          type="text"
          placeholder={`Search ${ALL_SONGS.length} songs…`}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <ul className="library-tab__list">
        {filtered.map(({ name, path }) => {
          const isExpanded = expanded === path;
          const isCurrent = name === currentSongName;
          const isLoading = loading === path;

          return (
            <li key={path} className="library-tab__item">
              <button
                className={[
                  'library-tab__row',
                  isCurrent ? 'library-tab__row--current' : '',
                  isExpanded ? 'library-tab__row--open' : '',
                ].filter(Boolean).join(' ')}
                disabled={isLoading}
                onClick={() => handleSongClick(path, name)}
              >
                <span className="library-tab__chevron">
                  {isLoading ? '◐' : isExpanded ? '▾' : '♪'}
                </span>
                <span className="library-tab__name">{name}</span>
                {isCurrent && <span className="library-tab__active-dot" title="Currently loaded" />}
              </button>

              {isExpanded && expandedData && (
                <div className="library-tab__detail">
                  {expandedData.song.musics[0].scores.length > 1 && (
                    <div className="library-tab__scores">
                      <span className="library-tab__scores-label">Tiles:</span>
                      {expandedData.song.musics[0].scores.map((_, si) => (
                        <button
                          key={si}
                          className={`library-tab__score-chip${selectedScores.has(si) ? ' library-tab__score-chip--active' : ''}`}
                          onClick={() => toggleScore(si)}
                        >
                          {SCORE_LABELS[si] ?? `Track ${si + 1}`}
                        </button>
                      ))}
                    </div>
                  )}
                  {expandedData.song.musics.map((music, i) => (
                    <button
                      key={music.id}
                      className="library-tab__diff-btn"
                      style={{ '--diff-color': DIFF_COLORS[i] ?? '#fff' } as React.CSSProperties}
                      onClick={() => handleLoad(i)}
                    >
                      <span className="library-tab__diff-label">
                        {DIFF_LABELS[i] ?? `Level ${i + 1}`}
                      </span>
                      <span className="library-tab__diff-bpm">{music.bpm} BPM</span>
                      <span className="library-tab__diff-load">Load ▶</span>
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}

        {filtered.length === 0 && (
          <li className="library-tab__empty">No songs match "{search}"</li>
        )}
      </ul>
    </div>
  );
}
