import { Router } from 'express';

import { loadSettings, maskSettings, saveSettings } from '../settings';

export function createSettingsRouter(): Router {
  const router = Router();

  // Get current settings (keys masked)
  router.get('/', async (_req, res) => {
    const settings = await loadSettings();
    res.json(maskSettings(settings));
  });

  // Get raw settings (for form population — includes full keys)
  router.get('/raw', async (_req, res) => {
    const settings = await loadSettings();
    res.json(settings);
  });

  // Update settings
  router.put('/', async (req, res) => {
    const updated = await saveSettings(req.body);
    res.json(maskSettings(updated));
  });

  return router;
}
