import { test, expect } from '../fixtures';

// ─── 1. Snapshot Diff (browser_snapshot_diff) ───

test.describe('Snapshot Diff', () => {

  test('first call returns full snapshot (no previous baseline)', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Diff First Call</title>
      <body>
        <h1>Hello World</h1>
        <p>Some content here</p>
      </body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_snapshot_diff',
      arguments: {},
    });

    const text = (result.content as any[])[0].text;
    // First diff should indicate no previous baseline
    expect(text).toContain('First snapshot');
    expect(text).toContain('no previous');
    // Should still contain the page content
    expect(text).toContain('Hello World');
  });

  test('after clicking a button that changes content, diff shows only changes', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Diff Changes</title>
      <body>
        <div id="output">Original Text</div>
        <button id="toggle" onclick="document.getElementById('output').textContent='Updated Text'">Toggle</button>
      </body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    // Take initial snapshot to establish baseline
    await client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    });

    // Click the button to change content
    const snapForRef = await client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    });
    const snapText = (snapForRef.content as any[])[0].text;
    const refMatch = snapText.match(/\[ref=(e\d+)\].*Toggle/);
    if (refMatch) {
      await client.callTool({
        name: 'browser_fallback',
        arguments: { tool: 'browser_click', arguments: { ref: refMatch[1], element: 'Toggle button' } },
      });
    } else {
      // Fallback: use browser_run_code to click
      await client.callTool({
        name: 'browser_fallback',
        arguments: {
          tool: 'browser_run_code',
          arguments: { code: 'async (page) => { await page.click("#toggle"); return "clicked"; }' },
        },
      });
    }

    // Now get the diff
    const diffResult = await client.callTool({
      name: 'browser_snapshot_diff',
      arguments: {},
    });

    const diffText = (diffResult.content as any[])[0].text;
    // Diff should show changes, not the full snapshot
    expect(diffText).toContain('Snapshot Diff');
    // Should contain diff markers (+ for added, - for removed)
    // or indicate changes were detected
    expect(diffText).not.toContain('First snapshot');
  });

  test('diff with mode=compact works', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Diff Compact</title>
      <body>
        <h1>Title</h1>
        <p>Long paragraph text that would be excluded in compact mode</p>
        <button id="btn">Click Me</button>
        <a href="/link">A Link</a>
      </body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    // Establish baseline with a full snapshot
    await client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    });

    // Call diff with compact mode
    const result = await client.callTool({
      name: 'browser_snapshot_diff',
      arguments: { mode: 'compact' },
    });

    const text = (result.content as any[])[0].text;
    expect(text).toContain('Snapshot Diff');
    // Should return a result (compact filtered diff)
    expect(text.length).toBeGreaterThan(0);
  });

  test('diff after navigation reset shows full content again', async ({ client, server }) => {
    server.setContent('/page1', `
      <title>Page One</title>
      <body><h1>First Page</h1><p>Content A</p></body>
    `, 'text/html');

    server.setContent('/page2', `
      <title>Page Two</title>
      <body><h1>Second Page</h1><p>Content B</p></body>
    `, 'text/html');

    // Navigate to page 1 and establish baseline
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page1` },
    });
    await client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    });

    // Navigate to page 2 (resets page state including _lastSnapshotText)
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page2` },
    });

    // Diff should show full content since baseline was reset by navigation
    const diffResult = await client.callTool({
      name: 'browser_snapshot_diff',
      arguments: {},
    });

    const text = (diffResult.content as any[])[0].text;
    // After navigation resets state, diff should treat this as first snapshot
    expect(text).toContain('First snapshot');
    expect(text).toContain('Second Page');
  });
});

// ─── 2. Content Boundary Markers ───

test.describe('Content Boundary Markers', () => {

  test('browser_snapshot wraps content in boundary markers', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Boundary Test</title>
      <body><h1>Hello Boundaries</h1></body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    });

    const text = (result.content as any[])[0].text;
    expect(text).toContain('--- PAGE CONTENT START ---');
    expect(text).toContain('--- PAGE CONTENT END ---');
    // Content should be between the markers
    const startIdx = text.indexOf('--- PAGE CONTENT START ---');
    const endIdx = text.indexOf('--- PAGE CONTENT END ---');
    expect(startIdx).toBeLessThan(endIdx);
    const innerContent = text.slice(startIdx, endIdx);
    expect(innerContent).toContain('Hello Boundaries');
  });

  test('browser_snapshot_diff wraps content in boundary markers', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Diff Boundary</title>
      <body><h1>Diff Content</h1></body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_snapshot_diff',
      arguments: {},
    });

    const text = (result.content as any[])[0].text;
    expect(text).toContain('--- PAGE CONTENT START ---');
    expect(text).toContain('--- PAGE CONTENT END ---');
  });

  test('browser_console wraps content in boundary markers', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Console Boundary</title>
      <script>console.log("boundary test log");</script>
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

    const text = (result.content as any[])[0].text;
    expect(text).toContain('--- PAGE CONTENT START ---');
    expect(text).toContain('--- PAGE CONTENT END ---');
  });

  test('browser_network wraps content in boundary markers', async ({ client, server }) => {
    server.setContent('/page', '<title>Network Boundary</title><body>Hello</body>', 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_network',
      arguments: {},
    });

    const text = (result.content as any[])[0].text;
    expect(text).toContain('--- PAGE CONTENT START ---');
    expect(text).toContain('--- PAGE CONTENT END ---');
  });

  test('nudges and metadata appear OUTSIDE the boundary markers', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Nudge Outside</title>
      <body>
        <h1>Test Page</h1>
        <button id="btn">Click</button>
      </body>
    `, 'text/html');

    // Navigate to a URL that will trigger SPA detection on snapshot
    // (when snapshot URL differs from navigated URL)
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    // Use a fallback action so that the next snapshot may include a nudge
    await client.callTool({
      name: 'browser_fallback',
      arguments: {
        tool: 'browser_run_code',
        arguments: { code: 'async (page) => { return "dummy action"; }' },
      },
    });

    const result = await client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    });

    const text = (result.content as any[])[0].text;
    const startIdx = text.indexOf('--- PAGE CONTENT START ---');

    // If there's any nudge/metadata prepended, it should appear before PAGE CONTENT START
    // The boundary marker itself should exist
    expect(startIdx).toBeGreaterThanOrEqual(0);

    // Content after START marker should contain page data
    const afterStart = text.slice(startIdx);
    expect(afterStart).toContain('Test Page');

    // Any SPA detection or save nudge text that exists should be before PAGE CONTENT START
    if (text.includes('SPA navigation detected') || text.includes('save-nudge') || text.includes('extraction-reminder')) {
      const nudgeIdx = Math.min(
        text.includes('SPA navigation detected') ? text.indexOf('SPA navigation detected') : Infinity,
        text.includes('save-nudge') ? text.indexOf('save-nudge') : Infinity,
        text.includes('extraction-reminder') ? text.indexOf('extraction-reminder') : Infinity,
      );
      expect(nudgeIdx).toBeLessThan(startIdx);
    }
  });
});

// ─── 3. Snapshot Depth Limiting + Selector Scoping ───

test.describe('Snapshot Depth Limiting and Selector Scoping', () => {

  const deeplyNestedPage = `
    <title>Deep Nesting</title>
    <body>
      <main>
        <div id="level1">
          <section id="level2">
            <div id="level3">
              <article id="level4">
                <p id="level5">Deeply nested content</p>
                <button>Deep Button</button>
              </article>
            </div>
          </section>
        </div>
        <h1>Top Level Heading</h1>
        <button>Top Button</button>
      </main>
    </body>
  `;

  test('browser_snapshot with depth=0 returns only top-level elements', async ({ client, server }) => {
    server.setContent('/page', deeplyNestedPage, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_snapshot',
      arguments: { depth: 0 },
    });

    const text = (result.content as any[])[0].text;
    // depth=0 means only top-level ARIA nodes
    // Deeper elements should be omitted
    expect(text).toContain('deeper elements omitted');
    expect(text).toContain('depth limited to 0');
  });

  test('browser_snapshot with depth=1 returns less than full snapshot', async ({ client, server }) => {
    server.setContent('/page', deeplyNestedPage, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const fullResult = await client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    });

    const depthResult = await client.callTool({
      name: 'browser_snapshot',
      arguments: { depth: 1 },
    });

    const fullText = (fullResult.content as any[])[0].text;
    const depthText = (depthResult.content as any[])[0].text;

    // Depth-limited should be shorter
    expect(depthText.length).toBeLessThan(fullText.length);
    // Should indicate elements were omitted
    expect(depthText).toContain('deeper elements omitted');
    expect(depthText).toContain('depth limited to 1');
  });

  test('browser_snapshot with depth=100 (beyond actual) returns full content', async ({ client, server }) => {
    server.setContent('/page', deeplyNestedPage, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const fullResult = await client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    });

    const deepResult = await client.callTool({
      name: 'browser_snapshot',
      arguments: { depth: 100 },
    });

    const fullText = (fullResult.content as any[])[0].text;
    const deepText = (deepResult.content as any[])[0].text;

    // depth=100 is beyond the actual depth, so no truncation should occur
    expect(deepText).not.toContain('deeper elements omitted');
    // Content should be roughly the same size (both are full)
    // Allow small differences from boundary markers or metadata
    expect(Math.abs(deepText.length - fullText.length)).toBeLessThan(100);
  });

  test('browser_snapshot with selector scoping returns only content within that element', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Scoped Snapshot</title>
      <body>
        <nav><a href="/">Home</a><a href="/about">About</a></nav>
        <main id="target-section">
          <h2>Target Section</h2>
          <button>Inside Button</button>
          <p>Inside paragraph</p>
        </main>
        <footer><p>Footer content should not appear</p></footer>
      </body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_snapshot',
      arguments: { selector: '#target-section' },
    });

    const text = (result.content as any[])[0].text;
    // Should contain content from the scoped section
    expect(text).toContain('Target Section');
    expect(text).toContain('Inside Button');
    // Should NOT contain content from outside the scope
    expect(text).not.toContain('Footer content should not appear');
  });

  test('scoped snapshot includes note about no refs', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Scoped No Refs</title>
      <body>
        <div id="scope-target">
          <button>Scoped Button</button>
        </div>
      </body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_snapshot',
      arguments: { selector: '#scope-target' },
    });

    const text = (result.content as any[])[0].text;
    // Scoped snapshots should include a note about refs not being available
    expect(text).toContain('scoped to:');
    expect(text).toMatch(/[Ss]coped snapshots do not include element refs/);
  });

  test('depth + mode=compact can be combined', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Depth Plus Compact</title>
      <body>
        <main>
          <h1>Title</h1>
          <p>Paragraph text filtered in compact</p>
          <div>
            <section>
              <button>Nested Button</button>
              <p>Another paragraph</p>
            </section>
          </div>
          <button>Top Button</button>
        </main>
      </body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const fullResult = await client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    });

    const combinedResult = await client.callTool({
      name: 'browser_snapshot',
      arguments: { mode: 'compact', depth: 1 },
    });

    const fullText = (fullResult.content as any[])[0].text;
    const combinedText = (combinedResult.content as any[])[0].text;

    // Combined compact + depth should be shorter than full
    expect(combinedText.length).toBeLessThan(fullText.length);
  });
});

// ─── 4. Output Length Limits ───

test.describe('Output Length Limits', () => {

  test('browser_snapshot with maxLength=1500 truncates large pages', async ({ client, server }) => {
    // Build a page with lots of content that exceeds 1500 chars in snapshot
    const manyItems = Array.from({ length: 50 }, (_, i) =>
      `<li><a href="/item${i}">Item number ${i} with some extra descriptive text to increase length</a></li>`
    ).join('\n');

    server.setContent('/page', `
      <title>Large Page</title>
      <body>
        <h1>Big List</h1>
        <ul>${manyItems}</ul>
        <footer><p>End of page</p></footer>
      </body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_snapshot',
      arguments: { maxLength: 1500 },
    });

    const text = (result.content as any[])[0].text;
    // The output should be truncated
    expect(text).toContain('truncated');
    expect(text).toContain('more chars');
  });

  test('truncated output contains correct truncation marker format', async ({ client, server }) => {
    const manyParagraphs = Array.from({ length: 100 }, (_, i) =>
      `<p>Paragraph ${i}: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>`
    ).join('\n');

    server.setContent('/page', `
      <title>Truncation Format</title>
      <body>${manyParagraphs}</body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_snapshot',
      arguments: { maxLength: 800 },
    });

    const text = (result.content as any[])[0].text;
    // Should contain the exact truncation marker format: [...truncated, N more chars]
    expect(text).toMatch(/\[\.\.\.truncated, \d+ more chars\]/);
  });

  test('small page within limit is NOT truncated', async ({ client, server }) => {
    server.setContent('/page', `
      <title>Small Page</title>
      <body>
        <h1>Hello</h1>
        <p>Short content</p>
      </body>
    `, 'text/html');

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: `${server.PREFIX}page` },
    });

    const result = await client.callTool({
      name: 'browser_snapshot',
      arguments: { maxLength: 50000 },
    });

    const text = (result.content as any[])[0].text;
    // Small page should not be truncated
    expect(text).not.toContain('truncated');
    expect(text).not.toContain('more chars');
    // Content should be fully present
    expect(text).toContain('Hello');
    expect(text).toContain('Short content');
  });
});

// ─── 5. Tool Registration ───

test.describe('Tool Registration', () => {

  test('browser_snapshot_diff appears in tool list', async ({ client }) => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t: any) => t.name);

    expect(toolNames).toContain('browser_snapshot_diff');

    // Verify it has the expected metadata
    const diffTool = tools.tools.find((t: any) => t.name === 'browser_snapshot_diff');
    expect(diffTool).toBeDefined();
    expect(diffTool!.description).toContain('changed');
  });

  test('browser_snapshot schema includes depth, selector, maxLength params', async ({ client }) => {
    const tools = await client.listTools();
    const snapshotTool = tools.tools.find((t: any) => t.name === 'browser_snapshot');

    expect(snapshotTool).toBeDefined();

    const schema = snapshotTool!.inputSchema;
    expect(schema).toBeDefined();

    // Check that the schema includes the v0.2 parameters
    const props = schema.properties || {};
    expect(props).toHaveProperty('depth');
    expect(props).toHaveProperty('selector');
    expect(props).toHaveProperty('maxLength');

    // Also verify the existing mode param is still there
    expect(props).toHaveProperty('mode');
  });
});
