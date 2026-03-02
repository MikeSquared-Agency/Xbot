'use strict';

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function matchUrlPattern(pattern, pathname) {
  if (pattern === '/*' || pattern === '*') return true;
  const regexStr = '^' + pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    + '$';
  try {
    return new RegExp(regexStr).test(pathname);
  } catch {
    return false;
  }
}

module.exports = { extractDomain, matchUrlPattern };
