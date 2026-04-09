import { Router } from 'express';
import * as fs from 'fs/promises';

import { getOutputPath } from '../pdf';
import type { SessionManager } from '../session-manager';

export function createFilesRouter(manager: SessionManager): Router {
  const router = Router();

  // Download markdown file
  router.get('/:id/download/md', async (req, res) => {
    const session = manager.getSession(req.params.id!);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.reportMarkdown) {
      return res.status(404).json({ error: 'Report not ready' });
    }

    const filePath = getOutputPath(session.name, 'md');
    try {
      await fs.access(filePath);
      res.download(filePath, `${session.name}.md`);
    } catch {
      // File might not exist on disk yet — serve from memory
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${session.name}.md"`,
      );
      res.send(session.reportMarkdown);
    }
  });

  // Download PDF file
  router.get('/:id/download/pdf', async (req, res) => {
    const session = manager.getSession(req.params.id!);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'completed') {
      return res.status(404).json({ error: 'Report not ready' });
    }

    const filePath = getOutputPath(session.name, 'pdf');
    try {
      await fs.access(filePath);
      res.download(filePath, `${session.name}.pdf`);
    } catch {
      return res.status(404).json({ error: 'PDF file not available' });
    }
  });

  return router;
}
