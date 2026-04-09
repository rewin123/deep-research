import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  type SessionDetail as SessionDetailType,
  getMarkdownUrl,
  getPdfUrl,
  getSession,
  submitFeedback,
} from '../api/client';
import { FeedbackForm } from '../components/FeedbackForm';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { ProgressView } from '../components/ProgressView';
import { useSessionSSE } from '../hooks/useSessionSSE';

const STATUS_LABELS: Record<string, string> = {
  created: 'Created',
  generating_feedback: 'Generating questions...',
  waiting_for_feedback: 'Awaiting your answers',
  researching: 'Researching...',
  generating_report: 'Writing report...',
  completed: 'Completed',
  error: 'Error',
};

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<SessionDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const sse = useSessionSSE(id);

  useEffect(() => {
    if (!id) return;
    getSession(id)
      .then(setSession)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  // Refresh session data when status changes
  useEffect(() => {
    if (!id || !sse.status) return;
    getSession(id).then(setSession).catch(console.error);
  }, [id, sse.status]);

  const handleFeedbackSubmit = async (answers: string[]) => {
    if (!id) return;
    setSubmittingFeedback(true);
    try {
      await submitFeedback(id, answers);
    } catch (err: any) {
      alert(`Failed to submit: ${err.message}`);
    } finally {
      setSubmittingFeedback(false);
    }
  };

  if (loading) return <div className="loading">Loading session...</div>;
  if (!session) return <div className="error-state">Session not found</div>;

  const currentStatus = sse.status || session.status;

  return (
    <div className="page">
      <div className="session-header">
        <div>
          <h1 className="session-title">{session.name}</h1>
          <p className="session-query">{session.query}</p>
        </div>
        <div className="session-meta">
          <span className={`badge badge-lg ${currentStatus === 'completed' ? 'badge-success' : currentStatus === 'error' ? 'badge-error' : currentStatus === 'waiting_for_feedback' ? 'badge-warning' : 'badge-active'}`}>
            {STATUS_LABELS[currentStatus] ?? currentStatus}
          </span>
          {sse.isConnected && <span className="connected-dot" title="Connected" />}
        </div>
      </div>

      {/* Error display */}
      {(sse.error || session.error) && (
        <div className="error-banner">
          {sse.error || session.error}
        </div>
      )}

      {/* Feedback section */}
      {currentStatus === 'waiting_for_feedback' &&
        sse.feedbackQuestions.length > 0 && (
          <FeedbackForm
            questions={sse.feedbackQuestions}
            onSubmit={handleFeedbackSubmit}
            disabled={submittingFeedback}
          />
        )}

      {/* Also show feedback from session data if SSE hasn't delivered yet */}
      {currentStatus === 'waiting_for_feedback' &&
        sse.feedbackQuestions.length === 0 &&
        session.feedbackQuestions.length > 0 && (
          <FeedbackForm
            questions={session.feedbackQuestions}
            onSubmit={handleFeedbackSubmit}
            disabled={submittingFeedback}
          />
        )}

      {/* Progress section */}
      {(currentStatus === 'researching' ||
        currentStatus === 'generating_report' ||
        currentStatus === 'generating_feedback') && (
        <ProgressView
          progress={sse.progress || session.progress}
          learningsCount={sse.learnings.length || session.learnings.length}
          urlsCount={sse.visitedUrls.length || session.visitedUrls.length}
          logs={sse.logs}
        />
      )}

      {/* Report section */}
      {currentStatus === 'completed' && session.reportMarkdown && (
        <div className="report-section">
          <div className="report-actions">
            <a
              href={getMarkdownUrl(session.id)}
              className="btn btn-secondary"
              download
            >
              Download Markdown
            </a>
            {session.pdfGenerated && (
              <a
                href={getPdfUrl(session.id)}
                className="btn btn-secondary"
                download
              >
                Download PDF
              </a>
            )}
          </div>
          <MarkdownPreview content={session.reportMarkdown} />
        </div>
      )}

      {/* Learnings summary (when available but not yet completed) */}
      {currentStatus !== 'completed' &&
        (sse.learnings.length > 0 || session.learnings.length > 0) && (
          <details className="learnings-section">
            <summary>
              Learnings ({sse.learnings.length || session.learnings.length})
            </summary>
            <ul className="learnings-list">
              {(sse.learnings.length > 0
                ? sse.learnings
                : session.learnings
              ).map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </details>
        )}
    </div>
  );
}
