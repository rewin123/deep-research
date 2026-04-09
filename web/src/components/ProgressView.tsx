interface ProgressData {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
}

export function ProgressView({
  progress,
  learningsCount,
  urlsCount,
  logs,
}: {
  progress: ProgressData | null;
  learningsCount: number;
  urlsCount: number;
  logs: string[];
}) {
  if (!progress) {
    return (
      <div className="progress-section">
        <div className="progress-spinner">Initializing research...</div>
      </div>
    );
  }

  const depthProgress = progress.totalDepth > 0
    ? ((progress.totalDepth - progress.currentDepth) / progress.totalDepth) * 100
    : 0;

  const queryProgress = progress.totalQueries > 0
    ? (progress.completedQueries / progress.totalQueries) * 100
    : 0;

  return (
    <div className="progress-section">
      <div className="progress-stats">
        <div className="stat">
          <span className="stat-label">Depth</span>
          <span className="stat-value">
            {progress.totalDepth - progress.currentDepth} / {progress.totalDepth}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Queries</span>
          <span className="stat-value">
            {progress.completedQueries} / {progress.totalQueries}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Learnings</span>
          <span className="stat-value">{learningsCount}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Sources</span>
          <span className="stat-value">{urlsCount}</span>
        </div>
      </div>

      <div className="progress-bar-container">
        <div className="progress-bar-label">Depth progress</div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${depthProgress}%` }} />
        </div>
      </div>

      <div className="progress-bar-container">
        <div className="progress-bar-label">Current level queries</div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${queryProgress}%` }} />
        </div>
      </div>

      {progress.currentQuery && (
        <div className="current-query">
          <span className="current-query-label">Searching:</span>{' '}
          {progress.currentQuery}
        </div>
      )}

      {logs.length > 0 && (
        <details className="logs-section">
          <summary>Activity log ({logs.length})</summary>
          <ul className="logs-list">
            {logs.map((log, i) => (
              <li key={i}>{log}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
