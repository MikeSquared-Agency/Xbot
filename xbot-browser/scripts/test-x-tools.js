#!/usr/bin/env node
'use strict'

/**
 * Integration test for x: workflow tools via xbot_execute.
 *
 * Usage:
 *   node scripts/test-x-tools.js [--browser chrome] [--handle yourhandle]
 *   node scripts/test-x-tools.js --browser chrome --test-reply --tweet-url https://x.com/.../status/123
 *
 * Options:
 *   --browser <name>    Browser to use (default: chrome)
 *   --handle <handle>   X handle to test profile/timeline (default: elonmusk)
 *   --test-reply        Enable x:post-reply test (posts a REAL reply)
 *   --tweet-url <url>   Tweet URL to reply to (required with --test-reply)
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')
const path = require('path')

function getArg(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const CLI_PATH = path.join(__dirname, '..', 'cli.js')
const BROWSER = getArg('--browser', 'chrome')
const TEST_HANDLE = getArg('--handle', 'elonmusk')
const TEST_REPLY = process.argv.includes('--test-reply')
const TWEET_URL = getArg('--tweet-url', '')

if (TEST_REPLY && !TWEET_URL) {
  console.error('Error: --test-reply requires --tweet-url <url>')
  process.exit(1)
}

const results = {}

async function run() {
  console.error('--- Starting xbot-browser MCP server ---')

  const transport = new StdioClientTransport({
    command: 'node',
    args: [CLI_PATH, '--browser', BROWSER],
    env: { ...process.env },
  })

  const client = new Client({ name: 'test-x-tools', version: '1.0.0' })
  await client.connect(transport)
  console.error('--- Connected ---')

  // Test x:check-session
  await test(client, 'x:check-session', {}, (text) => {
    return text.includes('"authenticated"')
  })

  const isAuth = results['x:check-session']?.text?.includes('"authenticated":true') ||
                 results['x:check-session']?.text?.includes('"authenticated": true')
  if (!isAuth) {
    console.error('Not authenticated. Cannot test auth-required tools.')
    await client.close()
    return
  }

  // Test x:get-author-profile
  await test(client, 'x:get-author-profile', { handle: TEST_HANDLE }, (text) => {
    return !text.includes('### Error') && text.includes('userName')
  })

  // Test x:get-author-timeline
  await test(client, 'x:get-author-timeline', { handle: TEST_HANDLE, count: 5 }, (text) => {
    if (text.includes('### Error')) return false
    try {
      const match = text.match(/"results"\s*:\s*\[/)
      if (!match) return text.length > 200
      const resultsStr = text.slice(text.indexOf('"results"'))
      const itemCount = (resultsStr.match(/","/g) || []).length + 1
      console.error(`  Got ~${itemCount} tweet(s)`)
      return itemCount > 1
    } catch { return text.length > 200 }
  })

  // Test x:search-tweets
  await test(client, 'x:search-tweets', { query: `from:${TEST_HANDLE}`, tab: 'latest' }, (text) => {
    return !text.includes('### Error') && text.length > 50
  })

  // Test x:post-reply (only with explicit opt-in and tweet URL)
  if (TEST_REPLY) {
    console.error('\n=== x:post-reply (LIVE TEST) ===')
    await test(client, 'x:post-reply', {
      tweet_url: TWEET_URL,
      reply_text: 'test reply from xbot - delete me',
    }, (text) => {
      return !text.includes('### Error') && (text.includes('"success"') || text.includes('success'))
    })
  } else {
    results['x:post-reply'] = { pass: 'SKIP', text: 'Pass --test-reply --tweet-url <url> to enable' }
  }

  // Summary
  console.error('\n--- Results ---')
  let failed = 0
  for (const [name, r] of Object.entries(results)) {
    const status = r.pass === 'SKIP' ? 'SKIP' : r.pass ? 'PASS' : 'FAIL'
    if (r.pass === false) failed++
    console.error(`  ${status}  ${name}`)
    if (!r.pass && r.pass !== 'SKIP') {
      console.error(`        ${truncate(r.text, 300)}`)
    }
  }

  await client.close()
  if (failed > 0) process.exit(1)
}

async function test(client, toolName, args, validate) {
  console.error(`\n=== ${toolName} ===`)
  const text = await callTool(client, 'xbot_execute', { toolName, args })
  const pass = validate(text)
  results[toolName] = { pass, text }
  console.error(pass ? 'PASS' : 'FAIL')
  console.error('Preview:', truncate(text, 500))
}

async function callTool(client, name, args) {
  try {
    const result = await client.callTool({ name, arguments: args })
    return (result.content || [])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n')
  } catch (err) {
    return `Error: ${err.message}`
  }
}

function truncate(str, n) {
  if (!str) return '(empty)'
  return str.length > n ? str.slice(0, n) + '...' : str
}

run().then(() => process.exit(0)).catch(err => { console.error('Fatal:', err); process.exit(1) })
