// DevSettingsPanel.tsx

interface DevSettingsPanelProps {
  showTapMarkers: boolean;
  setShowTapMarkers: (val: boolean) => void;
  interactiveScroll: boolean;
  setInteractiveScroll: (val: boolean) => void;
}

/**
 * DevSettingsPanel.tsx
 *
 * A specialized panel for board-level debugging tools.
 * Hosted inside the right-side sliding dev drawer.
 */
export function DevSettingsPanel({
  showTapMarkers,
  setShowTapMarkers,
  interactiveScroll,
  setInteractiveScroll,
}: DevSettingsPanelProps) {
  return (
    <div style={{
      padding: '24px',
      background: 'rgba(25, 25, 35, 0.95)',
      borderBottom: '1px solid rgba(0, 207, 255, 0.15)',
      color: '#fff',
      fontFamily: 'sans-serif'
    }}>
      <h3 style={{
        marginTop: 0,
        marginBottom: '20px',
        fontSize: '16px',
        color: '#00cfff',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        borderBottom: '2px solid rgba(0, 207, 255, 0.4)',
        display: 'inline-block',
        paddingBottom: '4px'
      }}>
        Board Settings
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Toggle: Tap Markers */}
        <label style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          padding: '8px 12px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '8px',
          transition: 'background 0.2s'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#e74c3c' }}>Show Tap Markers</span>
            <span style={{ fontSize: '12px', color: '#999' }}>Render a red dot at every touch location</span>
          </div>
          <input
            type="checkbox"
            checked={showTapMarkers}
            onChange={(e) => setShowTapMarkers(e.target.checked)}
            style={{ width: '20px', height: '20px', cursor: 'pointer' }}
          />
        </label>

        {/* Toggle: Interactive Scroll */}
        <label style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          padding: '8px 12px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '8px',
          transition: 'background 0.2s'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#3498db' }}>Interactive Scroll</span>
            <span style={{ fontSize: '12px', color: '#999' }}>Enable finger-dragging of the board (debug)</span>
          </div>
          <input
            type="checkbox"
            checked={interactiveScroll}
            onChange={(e) => setInteractiveScroll(e.target.checked)}
            style={{ width: '20px', height: '20px', cursor: 'pointer' }}
          />
        </label>
      </div>

      <div style={{
        marginTop: '20px',
        padding: '10px',
        fontSize: '11px',
        color: '#888',
        background: 'rgba(0, 0, 0, 0.2)',
        borderRadius: '4px',
        lineHeight: '1.4'
      }}>
        💡 Use <strong>Interactive Scroll</strong> after the song ends (or by pausing) to scroll back and inspect your tap markers relative to missed tiles.
      </div>
    </div>
  );
}
