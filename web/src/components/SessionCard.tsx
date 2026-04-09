import { Link } from 'react-router-dom';

import type { SessionSummary } from '../api/client';

const STATUS_LABELS: Record<string, string> = {
  created: 'Created',
  generating_feedback: 'Generating questions...',
  waiting_for_feedback: 'Awaiting your answers',
  researching: 'Researching...',
  generating_report: 'Writing report...',
  completed: 'Completed',
  error: 'Error',
};

const STATUS_CLASSES: Record<string, string> = {
  created: 'badge-neutral',
  generating_feedback: 'badge-active',
  waiting_for_feedback: 'badge-warning',
  researching: 'badge-active',
  generating_report: 'badge-active',
  completed: 'badge-success',
  error: 'badge-error',
};

export function SessionCard({ session }: { session: SessionSummary }) {
  const date = new Date(session.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Link to={`/session/${session.id}`} className="session-card">
      <div className="session-card-header">
        <span className={`badge ${STATUS_CLASSES[session.status] ?? 'badge-neutral'}`}>
          {STATUS_LABELS[session.status] ?? session.status}
        </span>
        <span className="session-date">{date}</span>
      </div>
      <h3 className="session-card-title">{session.name}</h3>
      <p className="session-card-query">{session.query}</p>
    </Link>
  );
}
