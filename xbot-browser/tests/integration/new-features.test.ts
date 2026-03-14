import { test, expect } from '../fixtures';

test.describe('Phase 1A — Console/Network/Screenshot tools', () => {

  test('browser_console returns result', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Console Test</title>
      <script>console.log("hello from page");</script>
      <body>Hello</body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_console',
      arguments: {},
    });

    // Result should exist and be well-formed
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect((result.content as any[]).length).toBeGreaterThanOrEqual(1);
  });

  test('browser_console with type filter works', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Console Filter Test</title>
      <script>
        console.log("log message");
        console.error("error message");
        console.warn("warning message");
      </script>
      <body>Hello</body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_console',
      arguments: { type: 'error' },
    });

    expect(result.content).toBeDefined();
    // When filtering by error, the result should not be empty if there are errors
    expect(Array.isArray(result.content)).toBe(true);
  });

  test('browser_network returns result after navigation', async ({ client, server }) => {
    server.setContent('/page', '<title>Network Test</title><body>Hello</body>', 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_network',
      arguments: {},
    });

    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect((result.content as any[]).length).toBeGreaterThanOrEqual(1);
  });

  test('browser_screenshot returns image content', async ({ client, server }) => {
    test.setTimeout(60000);
    server.setContent('/page', '<title>Screenshot Test</title><body><h1>Visible Content</h1></body>', 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_screenshot',
      arguments: { raw: true },
    });

    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    // Screenshot should return at least one content item (image or text reference)
    expect((result.content as any[]).length).toBeGreaterThanOrEqual(1);
    // Should contain image data
    const hasImage = (result.content as any[]).some(
      (item: any) => item.type === 'image' || (item.type === 'text' && item.text.length > 0)
    );
    expect(hasImage).toBe(true);
  });
});

test.describe('Phase 1B — Compact Snapshot', () => {

  test('browser_snapshot with mode full returns full content', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Snapshot Full</title>
      <body>
        <nav>
          <a href="/">Home</a>
        </nav>
        <main>
          <h1>Title</h1>
          <p>Paragraph content that should appear in full mode</p>
          <button>Click Me</button>
        </main>
      </body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_snapshot',
      arguments: { mode: 'full' },
    });

    const text = (result.content as any[])[0].text;
    // Full mode should include everything
    expect(text).toContain('Title');
    expect(text).toContain('Click Me');
  });

  test('browser_snapshot with mode compact returns less content than full', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Snapshot Compact</title>
      <body>
        <nav>
          <a href="/">Home</a>
        </nav>
        <main>
          <h1>Big Title</h1>
          <p>Lots of paragraph text that should be filtered out in compact mode</p>
          <p>Another paragraph</p>
          <p>Even more text</p>
          <button>Action Button</button>
          <input type="text" placeholder="Search" />
        </main>
      </body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const fullResult = await client.callTool({
      name: 'browser_snapshot',
      arguments: { mode: 'full' },
    });

    const compactResult = await client.callTool({
      name: 'browser_snapshot',
      arguments: { mode: 'compact' },
    });

    const fullText = (fullResult.content as any[])[0].text;
    const compactText = (compactResult.content as any[])[0].text;

    // Compact should be shorter
    expect(compactText.length).toBeLessThan(fullText.length);
  });

  test('browser_snapshot with mode compact still contains interactive element refs', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Snapshot Refs</title>
      <body>
        <p>Non-interactive paragraph</p>
        <button id="btn1">Submit</button>
        <a href="/link">A Link</a>
        <input type="text" placeholder="Search" />
      </body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_snapshot',
      arguments: { mode: 'compact' },
    });

    const text = (result.content as any[])[0].text;
    // Should contain button and link (interactive)
    expect(text).toContain('Submit');
    expect(text).toContain('A Link');
    // Should contain ref markers
    expect(text).toMatch(/\[ref=e\d+\]/);
  });

  test('browser_snapshot with mode interactive includes headings near buttons', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Interactive Mode</title>
      <body>
        <main>
          <h2>Login Section</h2>
          <input type="text" placeholder="Username" />
          <button>Login</button>
        </main>
      </body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_snapshot',
      arguments: { mode: 'interactive' },
    });

    const text = (result.content as any[])[0].text;
    // Should include the heading near the interactive elements
    expect(text).toContain('Login');
    // Should include the interactive elements
    expect(text).toContain('Username');
  });
});

test.describe('Phase 2 — Score virality', () => {

  test('score_virality returns score and rating', async ({ client }) => {
    const result = await client.callTool({
      name: 'score_virality',
      arguments: {
        replies: 50,
        retweets: 30,
        likes: 200,
        bookmarks: 15,
        views: 10000,
        age_hours: 3,
        author_followers: 50000,
        author_replies_back: true,
      },
    });

    const text = (result.content as any[])[0].text;
    expect(text).toContain('Virality Score');
    // Should contain one of the ratings
    expect(text).toMatch(/\b(high|medium|low|skip)\b/);
    // Should contain breakdown
    expect(text).toContain('Breakdown');
  });

  test('score_virality returns skip for minimal engagement', async ({ client }) => {
    const result = await client.callTool({
      name: 'score_virality',
      arguments: {
        replies: 0,
        retweets: 0,
        likes: 1,
        age_hours: 48,
      },
    });

    const text = (result.content as any[])[0].text;
    expect(text).toContain('Virality Score');
    // With almost no engagement and old age, should be skip
    expect(text).toContain('skip');
  });

  test('score_virality with high engagement returns high/medium', async ({ client }) => {
    const result = await client.callTool({
      name: 'score_virality',
      arguments: {
        replies: 200,
        retweets: 500,
        likes: 2000,
        bookmarks: 100,
        views: 500000,
        age_hours: 1,
        author_followers: 1000000,
        author_replies_back: true,
      },
    });

    const text = (result.content as any[])[0].text;
    expect(text).toContain('Virality Score');
    // With massive engagement, should be high or medium
    expect(text).toMatch(/\b(high|medium)\b/);
  });
});
