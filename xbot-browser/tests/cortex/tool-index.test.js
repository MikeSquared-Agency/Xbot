'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ToolIndex, configKey, toolKey } = require('../../src/cortex/tool-index');

describe('ToolIndex', () => {
  let dataDir;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-index-test-'));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('set and get returns the stored nodeId', () => {
    const idx = new ToolIndex(dataDir);
    idx.set('my-key', 'node-abc-123');
    expect(idx.get('my-key')).toBe('node-abc-123');
  });

  test('get on unknown key returns null', () => {
    const idx = new ToolIndex(dataDir);
    expect(idx.get('nonexistent')).toBeNull();
  });

  test('persists across ToolIndex instances with same dataDir', () => {
    const idx1 = new ToolIndex(dataDir);
    idx1.set('persist-key', 'node-999');

    const idx2 = new ToolIndex(dataDir);
    expect(idx2.get('persist-key')).toBe('node-999');
  });

  test('clear removes all entries', () => {
    const idx = new ToolIndex(dataDir);
    idx.set('key-a', 'node-a');
    idx.set('key-b', 'node-b');
    idx.clear();
    expect(idx.get('key-a')).toBeNull();
    expect(idx.get('key-b')).toBeNull();
  });

  test('configKey produces correct string', () => {
    expect(configKey('example.com', '/*')).toBe('config:example.com:/*');
    expect(configKey('shop.co', '/products/*')).toBe('config:shop.co:/products/*');
  });

  test('toolKey produces correct string', () => {
    expect(toolKey('example.com', 'add-to-cart')).toBe('tool:example.com:add-to-cart');
  });

  test('set overwrites existing entry for same key', () => {
    const idx = new ToolIndex(dataDir);
    idx.set('dup', 'old-id');
    idx.set('dup', 'new-id');
    expect(idx.get('dup')).toBe('new-id');
  });
});
