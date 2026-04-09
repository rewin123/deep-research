import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { after, before, describe, it } from 'node:test';

import { loadSettings, maskSettings, saveSettings } from './settings';
import { DEFAULT_SETTINGS } from './types';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

describe('Settings', () => {
  let originalContent: string | null = null;

  before(async () => {
    // Backup existing settings if present
    try {
      originalContent = await fs.readFile(SETTINGS_FILE, 'utf-8');
    } catch {
      originalContent = null;
    }
    // Remove for clean test
    try {
      await fs.unlink(SETTINGS_FILE);
    } catch {
      // Ignore
    }
  });

  after(async () => {
    // Restore original settings
    if (originalContent !== null) {
      await fs.writeFile(SETTINGS_FILE, originalContent, 'utf-8');
    } else {
      try {
        await fs.unlink(SETTINGS_FILE);
      } catch {
        // Ignore
      }
    }
  });

  it('should return default settings when no file exists', async () => {
    const settings = await loadSettings();
    assert.deepStrictEqual(settings, DEFAULT_SETTINGS);
  });

  it('should save and load settings', async () => {
    const saved = await saveSettings({ openaiKey: 'test-key-123' });
    assert.strictEqual(saved.openaiKey, 'test-key-123');
    assert.strictEqual(saved.contextSize, DEFAULT_SETTINGS.contextSize);

    const loaded = await loadSettings();
    assert.strictEqual(loaded.openaiKey, 'test-key-123');
  });

  it('should merge partial updates', async () => {
    await saveSettings({ openaiKey: 'key1' });
    await saveSettings({ tavilyApiKey: 'tavily1' });

    const loaded = await loadSettings();
    assert.strictEqual(loaded.openaiKey, 'key1');
    assert.strictEqual(loaded.tavilyApiKey, 'tavily1');
  });

  it('should mask sensitive keys', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      openaiKey: 'sk-1234567890abcdef',
      tavilyApiKey: 'tvly-abcdef123456',
      fireworksKey: '',
    };

    const masked = maskSettings(settings);
    // 'sk-1234567890abcdef' = 18 chars, first 4 shown, 14 masked
    assert.strictEqual(masked.openaiKey.slice(0, 4), 'sk-1');
    assert.ok(masked.openaiKey.includes('●'));
    // 'tvly-abcdef123456' = 17 chars, first 4 shown, 13 masked
    assert.strictEqual(masked.tavilyApiKey.slice(0, 4), 'tvly');
    assert.ok(masked.tavilyApiKey.includes('●'));
    assert.strictEqual(masked.fireworksKey, '');
    // Non-secret fields should remain unchanged
    assert.strictEqual(masked.contextSize, DEFAULT_SETTINGS.contextSize);
  });
});
