import * as fs from 'fs/promises';
import * as path from 'path';

import { type AppSettings, DEFAULT_SETTINGS } from './types';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(
  settings: Partial<AppSettings>,
): Promise<AppSettings> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const current = await loadSettings();
  const merged = { ...current, ...settings };
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

/** Mask sensitive keys for API responses */
export function maskSettings(settings: AppSettings): Record<string, any> {
  const mask = (val: string) =>
    val ? val.slice(0, 4) + '●'.repeat(Math.max(0, val.length - 4)) : '';
  return {
    ...settings,
    openaiKey: mask(settings.openaiKey),
    tavilyApiKey: mask(settings.tavilyApiKey),
    fireworksKey: mask(settings.fireworksKey),
  };
}

/** Convert AppSettings to the config objects used by core modules */
export function settingsToResearchConfig(settings: AppSettings) {
  return {
    modelSettings: {
      openaiKey: settings.openaiKey || undefined,
      openaiEndpoint: settings.openaiEndpoint || undefined,
      customModel: settings.customModel || undefined,
      fireworksKey: settings.fireworksKey || undefined,
      contextSize: settings.contextSize || undefined,
    },
    tavilyApiKey: settings.tavilyApiKey || undefined,
    tavilyConcurrency: settings.tavilyConcurrency || undefined,
    llmTimeout: settings.llmTimeout || undefined,
  };
}
