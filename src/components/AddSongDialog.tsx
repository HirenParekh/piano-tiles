/**
 * AddSongDialog.tsx
 *
 * Modal dialog for adding a custom Piano Tiles 2 song by pasting its JSON.
 */

import { useState, useRef, useEffect } from 'react';
import { validateSongJson } from '../hooks/useCustomSongs';

interface Props {
  onAdd: (title: string, author: string, json: string) => string | null;
  onClose: () => void;
}

export function AddSongDialog({ onAdd, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [json, setJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Live-validate JSON as user types (debounced by state update)
  const jsonError = json.trim() ? validateSongJson(json) : null;

  const handleAdd = () => {
    const err = onAdd(title, author, json);
    if (err) {
      setError(err);
    } else {
      setIsSuccess(true);
      setTimeout(() => onClose(), 800);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
        animation: 'fadeIn 0.15s ease',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>

      <div style={{
        background: 'linear-gradient(145deg, #1a2a4a, #142038)',
        borderRadius: '20px',
        padding: '28px 24px',
        width: '100%',
        maxWidth: '480px',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)',
        animation: 'slideUp 0.2s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#fff', fontFamily: 'Inter, sans-serif' }}>
              Add Custom Song
            </div>
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginTop: '2px', fontFamily: 'Inter, sans-serif' }}>
              Paste a Piano Tiles 2 JSON below
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%',
              width: '32px', height: '32px', color: '#fff', cursor: 'pointer',
              fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >✕</button>
        </div>

        {/* Title field */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter, sans-serif', letterSpacing: '0.05em' }}>
            SONG TITLE <span style={{ opacity: 0.5 }}>(optional)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. My Favorite Song"
            style={{
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '10px', padding: '10px 12px', color: '#fff',
              fontSize: '14px', fontFamily: 'Inter, sans-serif', outline: 'none',
              transition: 'border-color 0.2s',
            }}
            onFocus={e => e.target.style.borderColor = 'rgba(26,174,234,0.6)'}
            onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.15)'}
          />
        </div>

        {/* Author field */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter, sans-serif', letterSpacing: '0.05em' }}>
            ARTIST <span style={{ opacity: 0.5 }}>(optional)</span>
          </label>
          <input
            type="text"
            value={author}
            onChange={e => setAuthor(e.target.value)}
            placeholder="e.g. Bach"
            style={{
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '10px', padding: '10px 12px', color: '#fff',
              fontSize: '14px', fontFamily: 'Inter, sans-serif', outline: 'none',
              transition: 'border-color 0.2s',
            }}
            onFocus={e => e.target.style.borderColor = 'rgba(26,174,234,0.6)'}
            onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.15)'}
          />
        </div>

        {/* JSON textarea */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter, sans-serif', letterSpacing: '0.05em' }}>
            SONG JSON <span style={{ color: '#ff6b6b' }}>*</span>
          </label>
          <textarea
            ref={textareaRef}
            value={json}
            onChange={e => { setJson(e.target.value); setError(null); }}
            placeholder={'{\n  "baseBpm": 120,\n  "musics": [...]\n}'}
            rows={10}
            style={{
              background: 'rgba(0,0,0,0.3)',
              border: `1px solid ${jsonError && json ? 'rgba(255,100,100,0.5)' : 'rgba(255,255,255,0.15)'}`,
              borderRadius: '10px', padding: '12px',
              color: '#e2f0ff', fontSize: '12px',
              fontFamily: 'monospace', outline: 'none', resize: 'vertical',
              lineHeight: 1.5,
              transition: 'border-color 0.2s',
            }}
          />
          {/* Inline validation feedback */}
          {json.trim() && jsonError && (
            <div style={{ fontSize: '12px', color: '#ff8080', fontFamily: 'Inter, sans-serif', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
              <span>⚠️</span> {jsonError}
            </div>
          )}
          {json.trim() && !jsonError && (
            <div style={{ fontSize: '12px', color: '#68d391', fontFamily: 'Inter, sans-serif', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span>✓</span> Valid Piano Tiles 2 JSON
            </div>
          )}
        </div>

        {/* Save error */}
        {error && (
          <div style={{
            background: 'rgba(255,100,100,0.15)', border: '1px solid rgba(255,100,100,0.3)',
            borderRadius: '10px', padding: '10px 12px',
            fontSize: '13px', color: '#ff8080', fontFamily: 'Inter, sans-serif',
          }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '12px', borderRadius: '12px',
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.7)', fontSize: '14px', fontWeight: 700,
              fontFamily: 'Inter, sans-serif', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!json.trim() || !!jsonError || isSuccess}
            style={{
              flex: 2, padding: '12px', borderRadius: '12px', border: 'none',
              background: isSuccess
                ? 'linear-gradient(135deg, #48bb78, #38a169)'
                : (!json.trim() || !!jsonError)
                  ? 'rgba(26,174,234,0.3)'
                  : 'linear-gradient(135deg, #1aaeea, #0d9ed8)',
              color: '#fff', fontSize: '14px', fontWeight: 800,
              fontFamily: 'Inter, sans-serif', cursor: (!json.trim() || !!jsonError) ? 'not-allowed' : 'pointer',
              boxShadow: (!json.trim() || !!jsonError) ? 'none' : '0 4px 15px rgba(26,174,234,0.4)',
              transition: 'all 0.2s',
            }}
          >
            {isSuccess ? '✓ Added!' : '+ Add Song'}
          </button>
        </div>
      </div>
    </div>
  );
}
