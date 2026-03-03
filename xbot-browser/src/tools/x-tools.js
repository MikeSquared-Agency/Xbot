'use strict';

const fs = require('fs');

async function handleCheckSession(inner, progress) {
  // Navigate to x.com/home
  const result = await inner.callTool('browser_navigate', { url: 'https://x.com/home' }, progress);

  // Check the final URL and page content
  let url = 'https://x.com/home';
  let title = '';
  let authenticated = false;

  if (result?.content) {
    for (const item of result.content) {
      if (item.type !== 'text') continue;
      const urlMatch = item.text.match(/- Page URL:\s*(https?:\/\/\S+)/);
      if (urlMatch) url = urlMatch[1];
      const titleMatch = item.text.match(/- Page Title:\s*(.+)/);
      if (titleMatch) title = titleMatch[1].trim();
    }
  }

  // If we're redirected to a login page, session is invalid
  const isLoginPage = url.includes('/login') ||
                      url.includes('/i/flow/login') ||
                      url.includes('/account/access') ||
                      title.toLowerCase().includes('log in');

  authenticated = !isLoginPage;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ authenticated, url, title }, null, 2),
    }],
  };
}

async function handlePullAnalytics(inner, args, progress) {
  const days = args.days || 1;

  // Build date range: "to" is today, "from" is (days - 1) days ago
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));
  const fmt = (d) => d.toISOString().split('T')[0]; // YYYY-MM-DD

  // Navigate directly to the Content tab with from/to date params
  await inner.callTool('browser_navigate', {
    url: `https://x.com/i/account_analytics/content?type=all&sort=impressions&dir=desc&from=${fmt(from)}&to=${fmt(to)}`,
  }, progress);

  // Wait for the page to fully load
  await inner.callTool('browser_run_code', {
    code: `async (page) => {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}`,
  }, progress);

  // Snapshot the page so we can debug if download button isn't found
  const snapshot = await inner.callTool('browser_snapshot', {}, progress);

  // Trigger CSV export and capture the download
  // The download button is an icon-only button (no label text), so we search
  // broadly: aria-label, data-testid, svg download icons, and any button
  // whose accessible name hints at download/export/csv.
  const result = await inner.callTool('browser_run_code', {
    code: `async (page) => {
  // The download button is an icon-only button containing an SVG with
  // data-icon="icon-incoming" (arrow-down-to-tray icon). No text, no aria-label.
  const selectors = [
    // Primary: SVG data-icon attribute
    'button:has(svg[data-icon="icon-incoming"])',
    // Fallback: match the specific SVG path prefix from the download icon
    'button:has(svg path[d^="M11.99 16"])',
    // Broader: aria-label or data-testid if X adds them later
    '[aria-label*="download" i]',
    '[aria-label*="export" i]',
    '[data-testid*="download"]',
    '[data-testid*="export"]',
    // Text-labeled fallbacks
    'button:has-text("Export")',
    'button:has-text("Download")',
  ];

  let exportBtn = null;
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    const visible = await loc.isVisible({ timeout: 1000 }).catch(() => false);
    if (visible) {
      exportBtn = loc;
      break;
    }
  }

  if (!exportBtn) {
    throw new Error(
      'Could not find download button on analytics.x.com. ' +
      'The page layout may have changed.'
    );
  }

  // Set up download capture before clicking
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    exportBtn.click(),
  ]);

  // Return the download path — we read the file outside browser context
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error('Download failed — no file path received.');
  }

  return { downloadPath, filename: download.suggestedFilename() };
}`,
  }, progress);

  // Extract the download path from browser_run_code result, then read with fs.
  // The result text may contain:
  //   1. A JSON object like {"downloadPath": "...", "filename": "..."}
  //   2. Event text like 'Downloaded file ... to "path"'
  //   3. Raw CSV text
  let csvText = null;

  if (result?.content) {
    for (const item of result.content) {
      if (item.type !== 'text') continue;
      const text = item.text;

      // Try JSON return value
      try {
        const parsed = JSON.parse(text);
        if (parsed.downloadPath) {
          csvText = fs.readFileSync(parsed.downloadPath, 'utf-8');
          break;
        }
      } catch {}

      // Try extracting path from "Downloaded file ... to "path"" event text
      const downloadMatch = text.match(/Downloaded file .+ to "([^"]+)"/);
      if (downloadMatch) {
        const dlPath = downloadMatch[1];
        try {
          csvText = fs.readFileSync(dlPath, 'utf-8');
          break;
        } catch {}
      }

      // Check if it's raw CSV
      if (text.includes('Tweet id') || text.includes('tweet_id')) {
        csvText = text;
        break;
      }
    }
  }

  if (!csvText) {
    // If browser_run_code returned an error, include snapshot for debugging
    if (result?.isError) {
      let snapshotText = '';
      if (snapshot?.content) {
        for (const item of snapshot.content) {
          if (item.type === 'text') {
            snapshotText = item.text.slice(0, 2000);
            break;
          }
        }
      }
      const errText = result.content?.[0]?.text || 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: `### Error\n${errText}\n\n### Page snapshot (for debugging)\n${snapshotText}\n\n### Page URL\n${await inner.callTool('browser_run_code', { code: 'async (page) => ({ url: page.url() })' }).then(r => r.content?.[0]?.text || '').catch(() => '')}`,
        }],
        isError: true,
      };
    }
    return {
      content: [{
        type: 'text',
        text: '### Error\nFailed to extract CSV data from analytics export.',
      }],
      isError: true,
    };
  }

  return {
    content: [{
      type: 'text',
      text: csvText,
    }],
  };
}

module.exports = { handleCheckSession, handlePullAnalytics };
