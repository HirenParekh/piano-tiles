import { useState, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import songCatalog from '../songCatalog.json';

interface Props {
    onPlaySong: (id: string) => void;
}

export function SongSelection({ onPlaySong }: Props) {
    const parentRef = useRef<HTMLDivElement>(null);
    const [search, setSearch] = useState('');
    const isDevMode = new URLSearchParams(window.location.search).get('ui') === 'dev_mode';

    const visibleSongs = useMemo(() => {
        if (!search.trim()) return songCatalog;
        const q = search.toLowerCase();
        return songCatalog.filter(s => s.title.toLowerCase().includes(q));
    }, [search]);

    const rowVirtualizer = useVirtualizer({
        count: visibleSongs.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 104, // 90px card + 14px padding
        overscan: 10,
    });

    return (
        <div className="song-selection" style={{ paddingTop: '1rem', paddingBottom: '1rem' }}>

            {/* Search */}
            <div className="song-selection__search-bar">
                <div className="search">
                    <span>🔍</span>
                    <input
                        type="text"
                        placeholder="Search"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </div>

            {/* Song List */}
            <div
                className="song-selection__list"
                ref={parentRef}
                style={{ paddingBottom: '1rem' }}
            >
                <div
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const song = visibleSongs[virtualRow.index];
                        return (
                            <div
                                key={virtualRow.key}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: `${virtualRow.size}px`,
                                    transform: `translateY(${virtualRow.start}px)`,
                                    paddingBottom: '14px',
                                    boxSizing: 'border-box',
                                }}
                            >
                                <div className="song-selection__song-card" style={{ height: '100%' }}>
                                    <div className="level-tab">{virtualRow.index + 1}</div>
                                    <div className="content">
                                        <div className="title">{song.title}</div>
                                        <div className="author">{song.author}</div>
                                    </div>
                                    <div className="actions">
                                        <button
                                            className="play-btn"
                                            onClick={() => onPlaySong(song.id)}
                                        >
                                            Play
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {isDevMode && (
                <div style={{ padding: '0 20px', marginTop: 'auto' }}>
                    <button 
                      onClick={() => window.location.search = '?scene=fx'}
                      style={{
                        padding: '8px 12px',
                        background: 'rgba(255,255,255,0.1)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '4px',
                        color: '#888',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontFamily: 'monospace',
                        width: 'fit-content'
                      }}
                    >
                      ⚙️ DEBUG SANDBOX
                    </button>
                </div>
            )}
        </div>
    );
}
