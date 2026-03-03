'use strict';

const fs = require('fs');

/**
 * Seed Cortex with domain configs and tool definitions from a JSON seed file.
 * Non-destructive: skips any domain/tool that already exists.
 *
 * @param {CortexStore} store - The CortexStore instance
 * @param {string} seedPath - Absolute path to seeds/tools.json
 */
async function seedIfNeeded(store, seedPath) {
  if (!fs.existsSync(seedPath)) {
    console.error('[seed] No seed file at', seedPath);
    return;
  }

  let seedData;
  try {
    seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  } catch (e) {
    console.error('[seed] Failed to parse seed file:', e.message);
    return;
  }

  const domains = seedData.domains || [];
  const tools = seedData.tools || [];

  // Map domain name → configId for tool creation
  const configIds = {};

  // Phase 1: Ensure all domain configs exist
  for (const domainDef of domains) {
    const { domain, urlPattern, title, description } = domainDef;
    const pattern = urlPattern || '/*';

    try {
      const existing = await store.getConfigForDomainAndPattern(domain, pattern);
      if (existing) {
        configIds[domain] = existing.id;
        console.error(`[seed] domain "${domain}" exists (${existing.id})`);
        continue;
      }

      const config = await store.createConfig({
        domain,
        urlPattern: pattern,
        title: title || domain,
        description: description || '',
      });
      configIds[domain] = config.id;
      console.error(`[seed] domain "${domain}" created (${config.id})`);
    } catch (e) {
      console.error(`[seed] domain "${domain}" error:`, e.message);
    }
  }

  // Phase 2: Ensure all tools exist
  for (const toolDef of tools) {
    const { domain, name, description, inputSchema, execution } = toolDef;

    const configId = configIds[domain];
    if (!configId) {
      console.error(`[seed] tool "${name}" skipped — no config for domain "${domain}"`);
      continue;
    }

    try {
      const existing = await store.findToolByNameForDomain(domain, name);
      if (existing) {
        console.error(`[seed] tool "${name}" exists (${existing.id})`);
        continue;
      }

      const tool = await store.addTool({
        configId,
        name,
        description: description || '',
        inputSchema: inputSchema || [],
        execution: execution || {},
      });
      console.error(`[seed] tool "${name}" created (${tool.id})`);
    } catch (e) {
      console.error(`[seed] tool "${name}" error:`, e.message);
    }
  }

  console.error('[seed] Seeding complete');
}

module.exports = { seedIfNeeded };
