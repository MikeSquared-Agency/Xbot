import { test, expect } from '../fixtures';

function extractConfigId(text: string): string {
  // Match both "Config Created" and "Config Already Exists" responses
  const match = text.match(/\*\*(?:configId|ID)\*\*:\s*(\S+)/);
  if (!match) throw new Error(`Could not extract configId from response:\n${text}`);
  return match[1];
}

test.describe('Full XbotBackend integration', () => {

  test('cold start — no tools', async ({ client, server }) => {
    server.setContent('/page', '<title>Example</title><body>Hello</body>', 'text/html');

    const result = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const text = (result.content as any[])[0].text;
    expect(text).toContain('No saved tools for');
  });

  test('create config + add tool', async ({ client, server }) => {
    server.setContent('/page', '<title>Test</title><body><button id="btn">Click</button></body>', 'text/html');

    // Navigate first to establish domain
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    // Create config
    const configResult = await client.callTool({
      name: 'add_create-config',
      arguments: {
        domain: 'localhost',
        urlPattern: '/*',
        title: 'Test Site',
        description: 'Integration test site',
      },
    });

    const configText = (configResult.content as any[])[0].text;
    expect(configText).toMatch(/Config Created|Config Already Exists/);
    const configId = extractConfigId(configText);

    // Add tool
    const toolResult = await client.callTool({
      name: 'add_tool',
      arguments: {
        configId,
        name: 'click-button',
        description: 'Click the button',
        execution: JSON.stringify({
          submit: { selector: '#btn' },
        }),
      },
    });

    const toolText = (toolResult.content as any[])[0].text;
    expect(toolText).toContain('Tool Added');
    expect(toolText).toContain('click-button');
  });

  test('warm visit — tools loaded', async ({ client, server }) => {
    server.setContent('/page', '<title>Test</title><body><button id="btn">Click</button></body>', 'text/html');

    // Navigate to establish domain
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    // Create config and tool
    const configResult = await client.callTool({
      name: 'add_create-config',
      arguments: {
        domain: 'localhost',
        urlPattern: '/*',
        title: 'Warm Visit Test',
      },
    });
    const configId = extractConfigId((configResult.content as any[])[0].text);

    await client.callTool({
      name: 'add_tool',
      arguments: {
        configId,
        name: 'test-tool',
        description: 'A test tool',
        execution: JSON.stringify({ submit: { selector: '#btn' } }),
      },
    });

    // Navigate again — should show available tools
    const navResult = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const navText = (navResult.content as any[])[0].text;
    expect(navText).toContain('<available-tools');
    expect(navText).toContain('test-tool');
  });

  test('execute saved tool', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Exec Test</title>
      <body>
        <div id="result">Original</div>
        <button id="btn" onclick="document.getElementById('result').textContent='Clicked!'">Click</button>
      </body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const configResult = await client.callTool({
      name: 'add_create-config',
      arguments: { domain: 'localhost', urlPattern: '/*', title: 'Exec Test' },
    });
    const configId = extractConfigId((configResult.content as any[])[0].text);

    await client.callTool({
      name: 'add_tool',
      arguments: {
        configId,
        name: 'click-and-read',
        description: 'Click button and read result',
        execution: JSON.stringify({
          submit: { selector: '#btn' },
          resultSelector: '#result',
          resultType: 'text',
        }),
      },
    });

    const execResult = await client.callTool({
      name: 'xbot_execute',
      arguments: { toolName: 'click-and-read', args: {} },
    });

    const execText = (execResult.content as any[])[0].text;
    expect(execText).toContain('Executed: click-and-read');
  });

  test('tool failure returns error with selector timeout', async ({ client, server }) => {
    server.setContent('/page', '<title>Fail Test</title><body><div>No button here</div></body>', 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const configResult = await client.callTool({
      name: 'add_create-config',
      arguments: { domain: 'localhost', urlPattern: '/*', title: 'Fail Test' },
    });
    const configId = extractConfigId((configResult.content as any[])[0].text);

    await client.callTool({
      name: 'add_tool',
      arguments: {
        configId,
        name: 'broken-tool',
        description: 'Tool with bad selector',
        execution: JSON.stringify({
          submit: { selector: '#nonexistent-button-xyz' },
          resultSelector: '#also-missing',
          resultType: 'text',
        }),
      },
    });

    // Execute the tool — should fail with selector timeout
    const result = await client.callTool({
      name: 'xbot_execute',
      arguments: { toolName: 'broken-tool', args: {} },
    });

    const text = (result.content as any[])[0].text;
    expect(text).toContain('Executed: broken-tool');
    expect(text).toContain('Timeout');
  });

  test('memory search', async ({ client, server }) => {
    server.setContent('/page', '<title>Memory</title><body>Hello</body>', 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    // Create a config with searchable description
    const configResult = await client.callTool({
      name: 'add_create-config',
      arguments: {
        domain: 'localhost',
        urlPattern: '/*',
        title: 'Weather Dashboard',
        description: 'Check current weather and forecasts',
        tags: ['weather', 'forecast'],
      },
    });
    expect((configResult.content as any[])[0].text).toMatch(/Config Created|Config Already Exists/);

    // Search for it
    const searchResult = await client.callTool({
      name: 'xbot_memory',
      arguments: { query: 'weather forecast' },
    });

    const searchText = (searchResult.content as any[])[0].text;
    expect(searchText).toContain('Weather Dashboard');
    expect(searchText).toContain('localhost');
  });
});
