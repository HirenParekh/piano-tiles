interface HomeScreenProps {
  progress: number;
  statusMessage: string;
  isComplete: boolean;
  error: string | null;
  onPlay: () => void;
  onRetry: () => void;
}

export function HomeScreen({ progress, statusMessage, isComplete, error, onPlay, onRetry }: HomeScreenProps) {
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

      <button
        className="home-screen__play-btn"
        style={{ opacity: isComplete ? 1 : 0, pointerEvents: isComplete ? 'auto' : 'none' }}
        onClick={onPlay}
      >
        PLAY
      </button>
    </div>
  );
}
