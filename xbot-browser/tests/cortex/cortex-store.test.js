'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CortexStore } = require('../../src/cortex/cortex-store');

const TEST_DATA_DIR = path.join(os.tmpdir(), `cortex-test-${Date.now()}`);
const TEST_PORT = 19091;

let store;
let cortexProcess;

function uniqueDomain(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.example.com`;
}

beforeAll(async () => {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

  cortexProcess = spawn('cortex', [
    'serve', '--data-dir', TEST_DATA_DIR, '--http-port', String(TEST_PORT),
  ], { stdio: 'ignore' });

  // Wait for health
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${TEST_PORT}/health`);
      if (res.ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }

  store = new CortexStore({
    httpBase: `http://localhost:${TEST_PORT}`,
    toolIndexDir: TEST_DATA_DIR,
  });
}, 35000);

afterAll(() => {
  try { cortexProcess.kill(); } catch {}
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe('CortexStore', () => {
  test('createConfig creates domain node', async () => {
    const domain = uniqueDomain('create');
    const config = await store.createConfig({
      domain,
      urlPattern: '/*',
      title: 'Test Site',
      description: 'A test site',
      tags: ['test'],
    });

    expect(config).toHaveProperty('id');
    expect(config.domain).toBe(domain);
    expect(config.url_pattern).toBe('/*');
    expect(config.title).toBe('Test Site');
  });

  test('getConfigsForDomain returns created configs', async () => {
    const domain = uniqueDomain('getconfigs');
    await store.createConfig({ domain, urlPattern: '/*', title: 'Config A' });
    await store.createConfig({ domain, urlPattern: '/shop/*', title: 'Config B' });

    const configs = await store.getConfigsForDomain(domain);
    expect(configs.length).toBeGreaterThanOrEqual(2);
    expect(configs.some(c => c.title === 'Config A')).toBe(true);
    expect(configs.some(c => c.title === 'Config B')).toBe(true);
  });

  test('getConfigForDomainAndPattern returns exact match', async () => {
    const domain = uniqueDomain('exact');
    await store.createConfig({ domain, urlPattern: '/products/*', title: 'Products' });
    await store.createConfig({ domain, urlPattern: '/cart/*', title: 'Cart' });

    const found = await store.getConfigForDomainAndPattern(domain, '/products/*');
    expect(found).not.toBeNull();
    expect(found.title).toBe('Products');

    const notFound = await store.getConfigForDomainAndPattern(domain, '/checkout/*');
    expect(notFound).toBeNull();
  });

  test('addTool creates tool node with edge', async () => {
    const domain = uniqueDomain('addtool');
    const config = await store.createConfig({ domain, urlPattern: '/*' });

    const tool = await store.addTool({
      configId: config.id,
      name: 'search-products',
      description: 'Search for products',
      inputSchema: { query: { type: 'string' } },
      execution: { steps: [] },
    });

    expect(tool).toHaveProperty('id');
    expect(tool.name).toBe('search-products');
    expect(tool.config_id).toBe(config.id);

    const tools = await store.findToolsForUrl(domain, `https://${domain}/anything`);
    expect(tools.some(t => t.name === 'search-products')).toBe(true);
  });

  test('addTool with same name supersedes', async () => {
    const domain = uniqueDomain('supersede');
    const config = await store.createConfig({ domain, urlPattern: '/*' });

    const tool1 = await store.addTool({
      configId: config.id,
      name: 'checkout',
      description: 'Old checkout',
    });

    const tool2 = await store.addTool({
      configId: config.id,
      name: 'checkout',
      description: 'New checkout',
    });

    expect(tool2.id).not.toBe(tool1.id);
    expect(tool2.description).toBe('New checkout');

    const tools = await store.findToolsForUrl(domain, `https://${domain}/`);
    const checkoutTools = tools.filter(t => t.name === 'checkout');
    expect(checkoutTools).toHaveLength(1);
    expect(checkoutTools[0].description).toBe('New checkout');
  });

  test('findToolsForUrl returns empty for unknown domain', async () => {
    const tools = await store.findToolsForUrl('no-such-domain-ever.example.com', 'https://no-such-domain-ever.example.com/');
    expect(tools).toEqual([]);
  });

  test('findToolsForUrl matches URL patterns', async () => {
    const domain = uniqueDomain('urlmatch');
    const wildcardConfig = await store.createConfig({ domain, urlPattern: '/*' });
    await store.addTool({ configId: wildcardConfig.id, name: 'global-tool', description: 'Everywhere' });

    const dpConfig = await store.createConfig({ domain, urlPattern: '/dp/*' });
    await store.addTool({ configId: dpConfig.id, name: 'product-tool', description: 'Product pages' });

    const allTools = await store.findToolsForUrl(domain, `https://${domain}/dp/123`);
    expect(allTools.some(t => t.name === 'global-tool')).toBe(true);
    expect(allTools.some(t => t.name === 'product-tool')).toBe(true);

    const homeTools = await store.findToolsForUrl(domain, `https://${domain}/home`);
    expect(homeTools.some(t => t.name === 'global-tool')).toBe(true);
    expect(homeTools.some(t => t.name === 'product-tool')).toBe(false);
  });

  test('updateTool updates tool fields', async () => {
    const domain = uniqueDomain('update');
    const config = await store.createConfig({ domain, urlPattern: '/*' });
    const tool = await store.addTool({
      configId: config.id,
      name: 'editable',
      description: 'Original description',
    });

    const updated = await store.updateTool(tool.id, { description: 'Updated description' });
    expect(updated.description).toBe('Updated description');
  });

  test('deleteTool removes tool', async () => {
    const domain = uniqueDomain('delete');
    const config = await store.createConfig({ domain, urlPattern: '/*' });
    const tool = await store.addTool({
      configId: config.id,
      name: 'removable',
      description: 'Will be deleted',
    });

    const deleted = await store.deleteTool(tool.id);
    expect(deleted).toBe(true);

    const found = await store.findToolByName('removable');
    expect(found).toBeNull();
  });

  test('incrementFailureCount increments', async () => {
    const domain = uniqueDomain('failcount');
    const config = await store.createConfig({ domain, urlPattern: '/*' });
    const tool = await store.addTool({
      configId: config.id,
      name: 'fragile',
      description: 'Might fail',
    });

    const count1 = await store.incrementFailureCount(tool.id);
    expect(count1).toBe(1);
    const count2 = await store.incrementFailureCount(tool.id);
    expect(count2).toBe(2);
  });

  test('resetFailureCount resets to 0', async () => {
    const domain = uniqueDomain('failreset');
    const config = await store.createConfig({ domain, urlPattern: '/*' });
    const tool = await store.addTool({
      configId: config.id,
      name: 'recoverable',
      description: 'Will recover',
    });

    await store.incrementFailureCount(tool.id);
    await store.incrementFailureCount(tool.id);
    await store.resetFailureCount(tool.id);

    // Verify by incrementing again — should go to 1, not 3
    const count = await store.incrementFailureCount(tool.id);
    expect(count).toBe(1);
  });

  test('searchConfigsByQuery returns semantic matches', async () => {
    const domain = uniqueDomain('semantic');
    await store.createConfig({
      domain,
      urlPattern: '/*',
      title: 'Amazon shopping',
      description: 'Online marketplace for buying products',
      tags: ['shopping', 'ecommerce'],
    });

    const results = await store.searchConfigsByQuery('buy products', 5);
    expect(results.length).toBeGreaterThan(0);
    const match = results.find(r => r.domain === domain);
    expect(match).toBeDefined();
  });

  test('findToolByName finds globally', async () => {
    const domain = uniqueDomain('globalfind');
    const uniqueName = `global-tool-${Date.now()}`;
    const config = await store.createConfig({ domain, urlPattern: '/*' });
    await store.addTool({
      configId: config.id,
      name: uniqueName,
      description: 'Globally findable',
    });

    const found = await store.findToolByName(uniqueName);
    expect(found).not.toBeNull();
    expect(found.name).toBe(uniqueName);
  });

  test('findToolByNameForDomain scopes to domain', async () => {
    const domainA = uniqueDomain('scopeA');
    const domainB = uniqueDomain('scopeB');
    const toolName = `scoped-tool-${Date.now()}`;

    const configA = await store.createConfig({ domain: domainA, urlPattern: '/*' });
    await store.addTool({ configId: configA.id, name: toolName, description: 'On domain A' });

    const foundOnA = await store.findToolByNameForDomain(domainA, toolName);
    expect(foundOnA).not.toBeNull();
    expect(foundOnA.name).toBe(toolName);

    const foundOnB = await store.findToolByNameForDomain(domainB, toolName);
    expect(foundOnB).toBeNull();
  });
});

describe('CortexStore graceful degradation', () => {
  let downStore;

  beforeAll(() => {
    downStore = new CortexStore({
      httpBase: 'http://localhost:19999',
      toolIndexDir: TEST_DATA_DIR,
    });
  });

  test('findToolsForUrl returns [] when cortex is down', async () => {
    const result = await downStore.findToolsForUrl('example.com', 'https://example.com/');
    expect(result).toEqual([]);
  });

  test('findToolByName returns null when cortex is down', async () => {
    const result = await downStore.findToolByName('anything');
    expect(result).toBeNull();
  });

  test('searchConfigsByQuery returns [] when cortex is down', async () => {
    const result = await downStore.searchConfigsByQuery('anything');
    expect(result).toEqual([]);
  });

  test('getConfigsForDomain returns [] when cortex is down', async () => {
    const result = await downStore.getConfigsForDomain('example.com');
    expect(result).toEqual([]);
  });
});
