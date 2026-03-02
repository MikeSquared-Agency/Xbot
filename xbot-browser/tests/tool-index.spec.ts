import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const { ToolIndex, toolKey, configKey } = require('../src/cortex/tool-index');

let tmpDir: string;

test.beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-index-'));
});

test.afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('get returns null for unknown keys', () => {
  const idx = new ToolIndex(tmpDir);
  expect(idx.get('nonexistent')).toBeNull();
});

test('set then get returns the value', () => {
  const idx = new ToolIndex(tmpDir);
  idx.set('tool:example.com:click', 'node-123');
  expect(idx.get('tool:example.com:click')).toBe('node-123');
});

test('persists across instances (survives restart)', () => {
  const idx1 = new ToolIndex(tmpDir);
  idx1.set('tool:example.com:click', 'node-123');
  idx1.set('config:example.com:/**', 'node-456');

  // New instance reads from disk
  const idx2 = new ToolIndex(tmpDir);
  expect(idx2.get('tool:example.com:click')).toBe('node-123');
  expect(idx2.get('config:example.com:/**')).toBe('node-456');
});

test('creates data directory if missing', () => {
  const nested = path.join(tmpDir, 'a', 'b');
  const idx = new ToolIndex(nested);
  idx.set('k', 'v');
  expect(fs.existsSync(path.join(nested, 'tool-index.json'))).toBe(true);
});

test('delete removes entry and persists', () => {
  const idx = new ToolIndex(tmpDir);
  idx.set('k', 'v');
  idx.delete('k');
  expect(idx.get('k')).toBeNull();

  const idx2 = new ToolIndex(tmpDir);
  expect(idx2.get('k')).toBeNull();
});

test('clear wipes all entries and removes file', () => {
  const idx = new ToolIndex(tmpDir);
  idx.set('a', '1');
  idx.set('b', '2');
  idx.clear();
  expect(idx.get('a')).toBeNull();
  expect(fs.existsSync(path.join(tmpDir, 'tool-index.json'))).toBe(false);
});

test('set overwrites existing value (supersede)', () => {
  const idx = new ToolIndex(tmpDir);
  idx.set('tool:x.com:search', 'old-node');
  idx.set('tool:x.com:search', 'new-node');
  expect(idx.get('tool:x.com:search')).toBe('new-node');
});

test('toolKey and configKey helpers', () => {
  expect(toolKey('example.com', 'click')).toBe('tool:example.com:click');
  expect(configKey('example.com', '/**')).toBe('config:example.com:/**');
});
