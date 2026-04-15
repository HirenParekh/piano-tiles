import { useState, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import songCatalog from '../songCatalog.json';
import { useCustomSongs } from '../hooks/useCustomSongs';
import { AddSongDialog } from './AddSongDialog';

interface Props {
    onPlaySong: (id: string) => void;
}

export function SongSelection({ onPlaySong }: Props) {
    const parentRef = useRef<HTMLDivElement>(null);
    const [search, setSearch] = useState('');
    const [showAddDialog, setShowAddDialog] = useState(false);
    const isDevMode = new URLSearchParams(window.location.search).get('ui') === 'dev_mode';
    const { songs: customSongs, addSong, removeSong } = useCustomSongs();

    // Merge custom songs (tagged, pinned at top) with catalog
    const allSongs = useMemo(() => {
        const custom = customSongs.map(s => ({
            id: s.id,
            title: s.title,
            author: s.author,
            isCustom: true,
        }));
        const catalog = songCatalog.map(s => ({ ...s, isCustom: false }));
        const combined = [...custom, ...catalog];

        if (!search.trim()) return combined;
        const q = search.toLowerCase();
        return combined.filter(s => s.title.toLowerCase().includes(q) || s.author.toLowerCase().includes(q));
    }, [search, customSongs]);

    const rowVirtualizer = useVirtualizer({
        count: allSongs.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 104,
        overscan: 10,
    });

    return (
        <div className="song-selection" style={{ paddingTop: '1rem', paddingBottom: '1rem' }}>

            {/* Search + Add Button */}
            <div className="song-selection__search-bar">
                <div className="search">
                    <span>🔍</span>
                    <input
                        type="text"
                        placeholder="Search songs..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <button
                    onClick={() => setShowAddDialog(true)}
                    style={{
                        flexShrink: 0,
                        background: 'rgba(255,255,255,0.2)',
                        border: '1px solid rgba(255,255,255,0.4)',
                        borderRadius: '10px',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: '13px',
                        fontFamily: 'Inter, sans-serif',
                        padding: '6px 12px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'background 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                    }}
                    onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.3)')}
                    onMouseOut={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
                >
                    + Add
                </button>
            </div>

            {/* Song List */}
            <div
                className="song-selection__list"
                ref={parentRef}
                style={{ paddingBottom: '1rem' }}
            >
                {allSongs.length === 0 && (
                    <div style={{
                        textAlign: 'center', padding: '40px 20px',
                        color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter, sans-serif',
                        fontSize: '14px',
                    }}>
                        No songs found.
                    </div>
                )}
                <div
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const song = allSongs[virtualRow.index];
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
                                <div
                                    className="song-selection__song-card"
                                    style={{
                                        height: '100%',
                                        ...(song.isCustom ? {
                                            boxShadow: '0 4px 12px rgba(26,174,234,0.2)',
                                            border: '1px solid rgba(26,174,234,0.25)',
                                        } : {}),
                                    }}
                                >
                                    {/* Level tab: ★ for custom, number for catalog */}
                                    <div
                                        className="level-tab"
                                        style={song.isCustom ? {
                                            background: 'linear-gradient(135deg, #1aaeea, #0d9ed8)',
                                            fontSize: '16px',
                                        } : {}}
                                    >
                                        {song.isCustom ? '★' : virtualRow.index - customSongs.length + 1}
                                    </div>

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
                                        {/* Remove button for custom songs */}
                                        {song.isCustom && (
                                            <button
                                                onClick={() => removeSong(song.id)}
                                                title="Remove song"
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    color: '#cbd5e0',
                                                    fontSize: '16px',
                                                    cursor: 'pointer',
                                                    padding: '2px 4px',
                                                    lineHeight: 1,
                                                    alignSelf: 'flex-end',
                                                    marginTop: '2px',
                                                    transition: 'color 0.2s',
                                                }}
                                                onMouseOver={e => (e.currentTarget.style.color = '#fc8181')}
                                                onMouseOut={e => (e.currentTarget.style.color = '#cbd5e0')}
                                            >
                                                ✕
                                            </button>
                                        )}
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

            {/* Add Song Dialog */}
            {showAddDialog && (
                <AddSongDialog
                    onAdd={(title, author, json) => {
                        const err = addSong(title, author, json);
                        return err;
                    }}
                    onClose={() => setShowAddDialog(false)}
                />
            )}
        </div>
    );
}
