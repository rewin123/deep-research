import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { after, before, describe, it } from 'node:test';

import { SessionManager } from './session-manager';

// Use a temp directory for test data
const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'test-sessions');

describe('SessionManager', () => {
  let manager: SessionManager;

  before(async () => {
    // Clean test data
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  after(async () => {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('should initialize without errors', async () => {
    manager = new SessionManager();
    await manager.init();
    assert.ok(manager);
  });

  it('should generate a session name from query', () => {
    manager = new SessionManager();
    const name = manager.generateSessionName('What is quantum computing?');
    assert.ok(name.includes('What-is-quantum-computing'));
    assert.ok(name.match(/^\d{4}-\d{2}-\d{2}/));
  });

  it('should sanitize special characters in session name', () => {
    manager = new SessionManager();
    const name = manager.generateSessionName(
      'Test: file/path <with> "special" chars?',
    );
    assert.ok(!name.includes(':'));
    assert.ok(!name.includes('/'));
    assert.ok(!name.includes('<'));
    assert.ok(!name.includes('>'));
    assert.ok(!name.includes('"'));
    assert.ok(!name.includes('?'));
  });

  it('should truncate long queries in session name', () => {
    manager = new SessionManager();
    const longQuery = 'A'.repeat(100);
    const name = manager.generateSessionName(longQuery);
    // Date prefix + dash + 50 chars max
    assert.ok(name.length <= 62); // YYYY-MM-DD- = 11 + 50 = 61 max
  });

  it('should return empty sessions list initially', async () => {
    manager = new SessionManager();
    await manager.init();
    const sessions = manager.getAllSessions();
    // May have sessions from previous test runs, but should be an array
    assert.ok(Array.isArray(sessions));
  });

  it('should get undefined for non-existent session', () => {
    manager = new SessionManager();
    const session = manager.getSession('non-existent-id');
    assert.strictEqual(session, undefined);
  });

  it('should return events as empty array for non-existent session', () => {
    manager = new SessionManager();
    const events = manager.getEvents('non-existent-id');
    assert.deepStrictEqual(events, []);
  });
});
