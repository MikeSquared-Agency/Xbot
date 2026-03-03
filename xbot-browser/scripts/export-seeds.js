#!/usr/bin/env node
'use strict';

/**
 * Export all Cortex domain configs and tools to seed format.
 * Usage: node scripts/export-seeds.js > seeds/tools.json
 */

const httpBase = process.env.CORTEX_HTTP || 'http://localhost:9091';

function parseBody(body) {
  try { return JSON.parse(body); }
  catch { return {}; }
}

async function get(path) {
  const res = await fetch(`${httpBase}${path}`, {
    headers: { 'x-agent-id': 'xbot' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(`GET ${path}: ${json.error}`);
  return json.data;
}

async function main() {
  // Fetch all domain nodes
  const domainNodes = await get('/nodes?kind=domain&limit=200');
  if (!Array.isArray(domainNodes) || domainNodes.length === 0) {
    console.error('No domain nodes found');
    process.exit(1);
  }

  const domains = [];
  const tools = [];

  for (const node of domainNodes) {
    const data = parseBody(node.body);
    domains.push({
      domain: node.title,
      urlPattern: data.url_pattern || '/*',
      title: node.title,
      description: data.description || '',
    });

    // Get tool neighbors
    const neighbors = await get(`/nodes/${node.id}/neighbors?depth=1&direction=outgoing`);
    const toolNodes = (Array.isArray(neighbors) ? neighbors : [])
      .map(n => n.node || n)
      .filter(n => n.kind?.toLowerCase() === 'tool' && n.id !== node.id);

    for (const toolNode of toolNodes) {
      const toolData = parseBody(toolNode.body);
      tools.push({
        domain: node.title,
        name: toolNode.title,
        description: toolData.description || '',
        inputSchema: toolData.input_schema || [],
        execution: toolData.execution || {},
      });
    }
  }

  const seed = { version: 1, domains, tools };
  console.log(JSON.stringify(seed, null, 2));
}

main().catch(e => {
  console.error('Export failed:', e.message);
  process.exit(1);
});
