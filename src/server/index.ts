import cors from 'cors';
import express from 'express';
import * as path from 'path';

import { createFilesRouter } from './routes/files';
import { createSessionsRouter } from './routes/sessions';
import { createSettingsRouter } from './routes/settings';
import { SessionManager } from './session-manager';

const PORT = Number(process.env.PORT) || 3051;

async function main() {
  const app = express();
  const manager = new SessionManager();

  await manager.init();
  console.log('Session manager initialized');

  // Middleware
  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api/sessions', createSessionsRouter(manager));
  app.use('/api/sessions', createFilesRouter(manager));
  app.use('/api/settings', createSettingsRouter());

  // Serve React frontend (production build)
  const webDist = path.resolve(process.cwd(), 'web', 'dist');
  app.use(express.static(webDist));

  // SPA fallback — serve index.html for all non-API routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'), err => {
      if (err) {
        res.status(200).send(
          '<!DOCTYPE html><html><body>' +
            '<h1>Deep Research</h1>' +
            '<p>Frontend not built yet. Run <code>npm run build:web</code> first, ' +
            'or use <code>npm run dev</code> for development.</p>' +
            '</body></html>',
        );
      }
    });
  });

  app.listen(PORT, () => {
    console.log(`Deep Research server running on http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
