import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  type SessionSummary,
  createSession,
  deleteSession,
  getSessions,
} from '../api/client';
import { SessionCard } from '../components/SessionCard';

export function SessionList() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState('');
  const [breadth, setBreadth] = useState(4);
  const [depth, setDepth] = useState(2);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const loadSessions = useCallback(async () => {
    try {
      const data = await getSessions();
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    // Refresh list periodically
    const interval = setInterval(loadSessions, 5000);
    return () => clearInterval(interval);
  }, [loadSessions]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setCreating(true);
    try {
      const session = await createSession({ query: query.trim(), breadth, depth });
      navigate(`/session/${session.id}`);
    } catch (err: any) {
      alert(`Failed to create session: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this research session?')) return;
    await deleteSession(id);
    loadSessions();
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Research Sessions</h1>
        <button
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : 'New Research'}
        </button>
      </div>

      {showForm && (
        <form className="new-session-form" onSubmit={handleCreate}>
          <div className="form-group">
            <label htmlFor="query">What would you like to research?</label>
            <textarea
              id="query"
              className="form-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Enter your research question..."
              rows={3}
              autoFocus
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="breadth">
                Breadth <span className="hint">(2-10, default 4)</span>
              </label>
              <input
                id="breadth"
                type="number"
                className="form-input"
                value={breadth}
                onChange={e => setBreadth(Number(e.target.value))}
                min={1}
                max={10}
              />
            </div>
            <div className="form-group">
              <label htmlFor="depth">
                Depth <span className="hint">(1-5, default 2)</span>
              </label>
              <input
                id="depth"
                type="number"
                className="form-input"
                value={depth}
                onChange={e => setDepth(Number(e.target.value))}
                min={1}
                max={5}
              />
            </div>
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={creating || !query.trim()}
          >
            {creating ? 'Creating...' : 'Start Research'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="loading">Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div className="empty-state">
          <p>No research sessions yet.</p>
          <p>Click "New Research" to get started.</p>
        </div>
      ) : (
        <div className="sessions-grid">
          {sessions.map(session => (
            <div key={session.id} className="session-card-wrapper">
              <SessionCard session={session} />
              <button
                className="btn-delete"
                onClick={e => handleDelete(session.id, e)}
                title="Delete session"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
