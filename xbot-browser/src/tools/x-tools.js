'use strict';

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

module.exports = { handleCheckSession };
