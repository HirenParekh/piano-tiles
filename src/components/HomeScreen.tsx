interface HomeScreenProps {
  progress: number;
  statusMessage: string;
  error: string | null;
  onRetry: () => void;
}

export function HomeScreen({ progress, statusMessage, error, onRetry }: HomeScreenProps) {
  return (
    <div className="home-screen">
      <div className="home-screen__hero">
        <h1 className="home-screen__title">
          PIANO <span className="home-screen__title-accent">TILES</span>
        </h1>
        <p className="home-screen__tagline">TAP TO THE BEAT</p>
      </div>

      <div className="home-screen__loader">
        <div className="home-screen__progress-bar">
          <div
            className="home-screen__progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>

        {error ? (
          <div className="home-screen__error">
            <span className="home-screen__error-msg">{error}</span>
            <button className="home-screen__retry-btn" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : (
          <p className="home-screen__status">{statusMessage}</p>
        )}
      </div>

      <div style={{ position: 'absolute', bottom: '20px', left: '20px' }}>
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
            fontFamily: 'monospace'
          }}
        >
          ⚙️ DEBUG SANDBOX
        </button>
      </div>
    </div>
  );
}
