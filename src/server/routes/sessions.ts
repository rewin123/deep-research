import { Router } from 'express';

import type { SessionManager } from '../session-manager';

export function createSessionsRouter(manager: SessionManager): Router {
  const router = Router();

  // List all sessions
  router.get('/', (_req, res) => {
    const sessions = manager.getAllSessions();
    res.json(
      sessions.map(s => ({
        id: s.id,
        name: s.name,
        query: s.query,
        status: s.status,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        progress: s.progress,
      })),
    );
  });

  // Create a new session
  router.post('/', async (req, res) => {
    const { query, breadth, depth } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query is required' });
    }
    const session = await manager.createSession(
      query,
      breadth ?? 4,
      depth ?? 2,
    );
    res.status(201).json(session);
  });

  // Get session details
  router.get('/:id', (req, res) => {
    const session = manager.getSession(req.params.id!);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  });

  // Delete a session
  router.delete('/:id', async (req, res) => {
    const session = manager.getSession(req.params.id!);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    await manager.deleteSession(req.params.id!);
    res.json({ ok: true });
  });

  // Submit feedback answers
  router.post('/:id/feedback', (req, res) => {
    const { answers } = req.body;
    if (!Array.isArray(answers)) {
      return res.status(400).json({ error: 'answers must be an array' });
    }
    const ok = manager.submitFeedback(req.params.id!, answers);
    if (!ok) {
      return res
        .status(400)
        .json({ error: 'Session not awaiting feedback' });
    }
    res.json({ ok: true });
  });

  // SSE stream for session events
  router.get('/:id/events', (req, res) => {
    const session = manager.getSession(req.params.id!);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connected event
    res.write(`data: ${JSON.stringify({ type: 'connected', data: { sessionId: session.id } })}\n\n`);

    manager.addSSEClient(req.params.id!, res);

    req.on('close', () => {
      manager.removeSSEClient(req.params.id!, res);
    });
  });

  return router;
}
