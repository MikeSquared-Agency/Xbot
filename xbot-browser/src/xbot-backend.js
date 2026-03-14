'use strict';

const path = require('path');
const playwrightMcpDir = path.dirname(require.resolve('playwright/lib/mcp/program'));
const { BrowserServerBackend } = require(path.join(playwrightMcpDir, 'browser', 'browserServerBackend'));
const { toMcpTool } = require(path.join(playwrightMcpDir, 'sdk', 'tool'));
const { z } = require('playwright-core/lib/mcpBundle');
const { CortexStore, extractDomain } = require('./cortex/cortex-store');
const { ensureCortexRunning } = require('./cortex/cortex-process');
const fs = require('fs');
const { translateAction, translateWorkflow } = require('./action-translator');
const { ToolRegistry } = require('./tools/registry');
const { FallbackTracker } = require('./tools/fallback');
const { saveSession } = require('./browser/session');
const { seedIfNeeded } = require('./cortex/seed');
const {
  xbotExecuteSchema,
  browserFallbackSchema,
  xbotMemorySearchSchema,
  addCreateConfigSchema,
  addToolSchema,
  addUpdateToolSchema,
  addDeleteToolSchema,
  scoreViralitySchema,
} = require('./action-tools');
const { scoreVirality } = require('./score-virality');
const { getFingerprintScript } = require('./browser/fingerprint');

class XbotBackend {
  constructor(config, browserContextFactory, options = {}) {
    this._inner = new BrowserServerBackend(config, browserContextFactory, { allTools: true });
    this._store = new CortexStore({
      httpBase: process.env.CORTEX_HTTP || 'http://localhost:9091',
      timeoutMs: parseInt(process.env.CORTEX_TIMEOUT_MS || '2000', 10),
    });
    this._registry = new ToolRegistry(this._store);
    this._fallback = new FallbackTracker();
    this._sessionFile = options.sessionFile || null;
  }

  async initialize(clientInfo) {
    await ensureCortexRunning({
      httpBase: process.env.CORTEX_HTTP || 'http://localhost:9091',
      dataDir: process.env.CORTEX_DATA_DIR || './data/cortex',
      configPath: './cortex.toml',
      autostart: process.env.CORTEX_AUTOSTART !== 'false',
    });
    await seedIfNeeded(this._store, path.join(__dirname, '../seeds/tools.json'));
    await this._inner.initialize(clientInfo);

    // Inject fingerprint masking into new browser contexts
    this._fingerprintScript = getFingerprintScript();
  }

  _resetPageState() {
    this._fallback.reset();
    this._registry.resetPageState();
  }

  async listTools() {
    const navigateSchema = {
      name: 'browser_navigate',
      title: 'Navigate to a URL',
      description: 'Navigate to a URL in the browser. After navigation, available saved tools for the site will be shown.',
      inputSchema: z.object({
        url: z.string().describe('The URL to navigate to'),
      }),
      type: 'action',
    };

    const snapshotSchema = {
      name: 'browser_snapshot',
      title: 'Page snapshot',
      description: 'Capture accessibility snapshot of the current page, this is better than screenshot',
      inputSchema: z.object({
        filename: z.string().optional().describe('Save snapshot to markdown file instead of returning it in the response.'),
      }),
      type: 'readOnly',
    };

    return [
      navigateSchema,
      snapshotSchema,
      browserFallbackSchema,
      xbotExecuteSchema,
      xbotMemorySearchSchema,
      addCreateConfigSchema,
      addToolSchema,
      addUpdateToolSchema,
      addDeleteToolSchema,
      scoreViralitySchema,
    ].map(schema => toMcpTool(schema));
  }

  async callTool(name, rawArguments, progress) {
    switch (name) {
      case 'browser_navigate':
        return this._handleNavigate(rawArguments, progress);
      case 'browser_snapshot':
        return this._handleSnapshot(rawArguments, progress);
      case 'browser_fallback':
        return this._handleFallback(rawArguments, progress);
      case 'xbot_execute':
        return this._handleExecute(rawArguments, progress);
      case 'xbot_memory':
        return this._handleMemorySearch(rawArguments);
      case 'add_create-config':
        return this._handleCreateConfig(rawArguments);
      case 'add_tool':
        return this._handleAddTool(rawArguments);
      case 'add_update-tool':
        return this._handleUpdateTool(rawArguments);
      case 'add_delete-tool':
        return this._handleDeleteTool(rawArguments);
      case 'score_virality':
        return this._handleScoreVirality(rawArguments);
      default:
        return {
          content: [{ type: 'text', text: `### Error\nTool "${name}" not found. Use browser_fallback to access raw Playwright tools.` }],
          isError: true,
        };
    }
  }

  // ─── Navigate with multi-stage URL resolution ───

  async _handleNavigate(args, progress) {
    this._resetPageState();

    // Stage 1: Navigate
    let result = await this._inner.callTool('browser_navigate', args, progress);

    // Inject fingerprint masking (fire-and-forget on first navigation)
    if (this._fingerprintScript && !this._fingerprintInjected) {
      this._fingerprintInjected = true;
      this._inner.callTool('browser_run_code', {
        code: `async (page) => { await page.context().addInitScript(${JSON.stringify(this._fingerprintScript)}); return { injected: true }; }`,
      }).catch(() => {});
    }

    result = truncateResult(result);
    const requestedUrl = args.url;

    await this._registry.lookupToolsForUrl(requestedUrl);

    // Stage 2: Server-side redirect detection
    if (this._registry.currentTools.length === 0) {
      const finalUrl = extractFinalUrl(result);
      if (finalUrl && finalUrl !== requestedUrl) {
        await this._registry.lookupToolsForUrl(finalUrl);
      }
    }

    // Stage 3: SPA client-side redirect detection
    if (this._registry.currentTools.length === 0 && this._registry.currentDomain) {
      try {
        const spaResult = await this._inner.callTool('browser_run_code', {
          code: [
            'async (page) => {',
            '  const startUrl = page.url();',
            '  try {',
            '    await page.waitForURL(url => url.toString() !== startUrl, { timeout: 2000 });',
            '  } catch {}',
            '  return { url: page.url() };',
            '}',
          ].join('\n'),
        });
        const spaUrl = extractFinalUrl(spaResult);
        if (spaUrl && spaUrl !== this._registry.currentUrl) {
          await this._registry.lookupToolsForUrl(spaUrl);
        }
      } catch {}
    }

    // Inject Cortex domain briefing if available
    if (this._registry.currentDomain && this._registry.currentTools.length > 0) {
      try {
        const briefingUrl = `${this._store._httpBase || 'http://localhost:9091'}/briefing/xbot?compact=true`;
        const res = await fetch(briefingUrl, { signal: AbortSignal.timeout(2000) }).catch(() => null);
        if (res?.ok) {
          const json = await res.json();
          if (json.success && json.data?.rendered) {
            const briefing = postProcessBriefing(json.data.rendered, 600);
            if (briefing) {
              const briefingBlock = `<domain-memory domain="${this._registry.currentDomain}">\n${briefing}\n</domain-memory>\n\n`;
              result = prependTextToResult(result, briefingBlock);
            }
          }
        }
      } catch {}
    }

    // Prepend available tools info
    const domain = this._registry.currentDomain;
    if (this._registry.currentTools.length > 0) {
      const toolList = this._registry.formatToolList();

      const extra = `<available-tools domain="${domain}">
${toolList}
</available-tools>
<navigation-reminder>
You have saved tools for ${domain}. Use xbot_execute to run them.
If you need browser_fallback for something not yet saved, you MUST save a complete tool with add_tool before you are done. This includes resultSelector for data extraction.
</navigation-reminder>\n\n`;
      return prependTextToResult(result, extra);
    } else if (domain) {
      const extra = `<navigation-reminder>
No saved tools for ${domain}. Use browser_fallback to interact with the page.
</navigation-reminder>\n\n`;
      return prependTextToResult(result, extra);
    }

    return result;
  }

  // ─── Snapshot with SPA detection + nudges ───

  async _handleSnapshot(args, progress) {
    let result = await this._inner.callTool('browser_snapshot', args, progress);
    result = truncateResult(result);

    let nudgePrefix = '';

    // Late SPA detection
    const snapshotUrl = extractFinalUrl(result);
    if (snapshotUrl && snapshotUrl !== this._registry.lastLookedUpUrl) {
      await this._registry.lookupToolsForUrl(snapshotUrl);

      if (this._registry.currentTools.length > 0) {
        const toolList = this._registry.formatToolList();
        nudgePrefix += `<tools-discovered domain="${this._registry.currentDomain}">
<context>SPA navigation detected — saved tools are available for this page.</context>
${toolList}
<instruction>Use xbot_execute for these tools instead of browser_fallback.</instruction>
</tools-discovered>\n\n`;
      }
    }

    // Save nudge after fallback action
    if (this._fallback.nudgePending) {
      this._fallback.nudgePending = false;
      nudgePrefix += this._fallback.buildSaveNudge(
        this._registry.currentDomain,
        this._registry.currentTools,
        this._registry.currentConfigs
      ) + '\n\n';
    }

    // Extraction reminder
    if (!this._fallback.extractionHintShown
        && this._fallback.everUsed
        && !this._fallback.savedToolCategories.has('extraction')
        && !this._fallback.nudgePending) {
      this._fallback.extractionHintShown = true;

      const hasIncomplete = this._registry.currentTools.some(t =>
        (t.execution?.fields?.length > 0 || t.execution?.submit) && !t.execution?.resultSelector);

      if (hasIncomplete) {
        const incomplete = this._registry.currentTools.find(t =>
          (t.execution?.fields?.length > 0 || t.execution?.submit) && !t.execution?.resultSelector);
        nudgePrefix += `<tool-incomplete>
<observation>Your saved tool "${incomplete.name}" has NO resultSelector — it won't return data.</observation>
<instruction>Use add_update-tool to add "resultSelector" and "resultType" to the execution.</instruction>
</tool-incomplete>\n\n`;
      } else {
        nudgePrefix += `<extraction-reminder>
<observation>You took a snapshot to read page data but your saved tools don't extract anything.</observation>
<instruction>Update your tool or save a new one with "resultSelector" and "resultType" in the execution.</instruction>
</extraction-reminder>\n\n`;
      }
    }

    if (nudgePrefix) {
      result = prependTextToResult(result, nudgePrefix);
    }

    return result;
  }

  // ─── Fallback with reminders ───

  async _getUpstreamTools() {
    if (!this._upstreamToolsCache) {
      this._upstreamToolsCache = await this._inner.listTools();
    }
    return this._upstreamToolsCache;
  }

  async _handleFallback(args, progress) {
    const toolName = args.tool;
    const toolArgs = args.arguments || {};

    if (!toolName) {
      const tools = await this._getUpstreamTools();
      const toolList = tools.map(t => {
        const desc = (t.description || '').replace(/\n/g, ' ').slice(0, 120);
        return `- **${t.name}**: ${desc}${desc.length >= 120 ? '...' : ''}`;
      }).join('\n');
      const reminder = this._fallback.buildFallbackListReminder(
        this._registry.currentDomain,
        this._registry.currentTools
      );
      return {
        content: [{ type: 'text', text: `### Available Playwright Tools\n${toolList}\n\nUse \`peek: true\` to inspect a tool's full input schema before calling it.\nExample: \`browser_fallback({ tool: "browser_click", peek: true })\`${reminder}` }],
      };
    }

    if (args.peek === true) {
      const tools = await this._getUpstreamTools();
      const match = tools.find(t => t.name === toolName);
      if (!match) {
        return {
          content: [{ type: 'text', text: `Unknown tool: "${toolName}". Call browser_fallback without a tool argument to list available tools.` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: `### Schema for ${toolName}\n\`\`\`json\n${JSON.stringify(match.inputSchema, null, 2)}\n\`\`\`\n\n**Description**: ${match.description || '(none)'}` }],
      };
    }

    // State tracking
    this._fallback.trackFallbackUse(toolName, summarizeArgs(toolName, toolArgs));

    let result = await this._inner.callTool(toolName, toolArgs, progress);
    result = truncateResult(result);

    // Auto-peek on validation failure
    if (result.isError) {
      const errText = result.content?.[0]?.text || '';
      if (errText.includes('invalid_type') || errText.includes('invalid_union') || errText.includes('unrecognized_keys')) {
        const tools = await this._getUpstreamTools();
        const match = tools.find(t => t.name === toolName);
        if (match) {
          const schemaHint = `\n\n### Correct schema for ${toolName}\n\`\`\`json\n${JSON.stringify(match.inputSchema, null, 2)}\n\`\`\`\n\n**Description**: ${match.description || '(none)'}`;
          result = appendTextToResult(result, schemaHint);
        }
      }
    }

    // Save reminder after fallback action
    if (!this._fallback.isReadOnly(toolName)) {
      result = appendTextToResult(result, this._fallback.buildSaveReminder(toolName));
    }

    return result;
  }

  // ─── xbot_execute (run a saved tool) ───

  async _handleExecute(args, progress) {
    const { toolName, args: toolArgs = {} } = args;

    if (!toolName) {
      return {
        content: [{ type: 'text', text: '### Error\nMissing "toolName" parameter.' }],
        isError: true,
      };
    }

    const tool = await this._registry.resolveToolByName(toolName);

    if (!tool) {
      return {
        content: [{ type: 'text', text: `### Error\nTool "${toolName}" not found. Navigate to a site to see available tools.` }],
        isError: true,
      };
    }

    // Parse input_schema (params) from DB
    const params = Array.isArray(tool.input_schema) ? tool.input_schema : [];
    const execution = tool.execution || {};

    // Validate required params
    const missingParams = params
      .filter(p => p.required && toolArgs[p.name] === undefined)
      .map(p => p.name);

    if (missingParams.length > 0) {
      return {
        content: [{ type: 'text', text: `### Error\nMissing required parameters: ${missingParams.join(', ')}` }],
        isError: true,
      };
    }

    // Apply defaults
    const resolvedArgs = { ...toolArgs };
    for (const param of params) {
      if (resolvedArgs[param.name] === undefined && param.default !== undefined) {
        resolvedArgs[param.name] = param.default;
      }
    }

    // Translate to Playwright code
    const isWorkflow = execution.type === 'workflow';
    let code;
    try {
      code = isWorkflow
        ? translateWorkflow({ execution, params }, resolvedArgs)
        : translateAction({ execution, params }, resolvedArgs);
    } catch (e) {
      return {
        content: [{ type: 'text', text: `### Error translating tool\n${String(e)}` }],
        isError: true,
      };
    }

    // Execute
    let result = await this._inner.callTool('browser_run_code', { code }, progress);

    // Workflow download post-processing: read file from disk
    if (isWorkflow && !result.isError && result.content) {
      for (const item of result.content) {
        if (item.type !== 'text') continue;
        const text = item.text;

        // Try extracting downloadPath from JSON embedded in the result text
        const jsonMatch = text.match(/"downloadPath"\s*:\s*"([^"]+)"/);
        if (jsonMatch) {
          try {
            item.text = fs.readFileSync(jsonMatch[1], 'utf-8');
            break;
          } catch {}
        }

        // Try "Downloaded file ... to "path"" event format
        const dlMatch = text.match(/Downloaded file .+ to "([^"]+)"/);
        if (dlMatch) {
          try {
            item.text = fs.readFileSync(dlMatch[1], 'utf-8');
            break;
          } catch {}
        }
      }
    }

    // Selector resilience: detect failures and try fallback selectors
    const errText = result.content?.[0]?.text || '';
    const isSelectorFailure = /No element found|Timeout|waiting for selector|locator resolved to/.test(errText);

    if (result.isError && isSelectorFailure && tool.fallback_selectors) {
      for (const fallbackSet of tool.fallback_selectors) {
        try {
          const fallbackExecution = { ...execution, ...fallbackSet };
          const fallbackCode = translateAction({ execution: fallbackExecution, params }, resolvedArgs);
          const fallbackResult = await this._inner.callTool('browser_run_code', { code: fallbackCode }, progress);
          if (!fallbackResult.isError) {
            // Fallback succeeded — reset failure count
            if (tool.id && tool.failure_count > 0) {
              await this._store.resetFailureCount(tool.id);
            }
            const header = `### Executed: ${tool.name} (fallback selector)\n`;
            return prependTextToResult(fallbackResult, header);
          }
        } catch {}
      }

      // All fallbacks failed — increment failure count
      if (tool.id) {
        const newCount = await this._store.incrementFailureCount(tool.id);
        // Decay importance on repeated failure
        if (newCount >= 2) {
          this._boostImportance(tool.id, -0.1);
        }
        if (newCount >= 3) {
          result = appendTextToResult(result, `\n\n<relearn-nudge>This tool has failed ${newCount} times. Its selectors may be outdated. Use browser_snapshot to inspect the page and update the tool with add_update-tool.</relearn-nudge>`);
        }
      }
    } else if (!result.isError && tool.id && tool.failure_count > 0) {
      // Success after previous failures — reset
      await this._store.resetFailureCount(tool.id);
    }

    // Fire-and-forget importance boost on success
    if (!result.isError && tool.id) {
      this._boostImportance(tool.id, 0.05);
    }

    const header = `### Executed: ${tool.name}\n`;
    return prependTextToResult(result, header);
  }

  // ─── Importance feedback ───

  /**
   * Fire-and-forget importance adjustment via Cortex PATCH.
   * Positive delta = boost, negative = decay. Clamps to [0.1, 1.0].
   */
  _boostImportance(nodeId, delta) {
    const httpBase = process.env.CORTEX_HTTP || 'http://localhost:9091';
    fetch(`${httpBase}/nodes/${nodeId}`, { signal: AbortSignal.timeout(2000) })
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        if (!json?.success) return;
        const current = json.data.importance || 0.5;
        const adjusted = Math.max(0.1, Math.min(1.0, current + delta));
        return fetch(`${httpBase}/nodes/${nodeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ importance: adjusted }),
          signal: AbortSignal.timeout(2000),
        });
      })
      .catch(() => {}); // intentionally swallowed — fire-and-forget
  }

  // ─── xbot_memory (semantic search) ───

  async _handleMemorySearch(args) {
    const { query } = args;

    if (!query) {
      return {
        content: [{ type: 'text', text: '### Error\nMissing "query" parameter.' }],
        isError: true,
      };
    }

    try {
      const configs = await this._store.searchConfigsByQuery(query);

      if (configs.length === 0) {
        return {
          content: [{ type: 'text', text: `### No results\nNo saved sites match "${query}". Try navigating to a site manually with browser_navigate.` }],
        };
      }

      let text = `### Memory search results for "${query}"\n\n`;
      for (const config of configs) {
        text += `**${config.title}** — \`${config.domain}\`\n`;
        if (config.description) {
          text += `  ${config.description}\n`;
        }
        if (config.tools.length > 0) {
          text += `  Tools: ${config.tools.map(t => `\`${t.name}\``).join(', ')}\n`;
        } else {
          text += `  No saved tools yet.\n`;
        }
        text += '\n';
      }

      text += `Use \`browser_navigate\` to go to the relevant site, then use \`xbot_execute\` to run its saved tools.`;

      return {
        content: [{ type: 'text', text }],
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: `### Error searching memory\n${e.message || String(e)}` }],
        isError: true,
      };
    }
  }

  // ─── add_create-config ───

  async _handleCreateConfig(args) {
    const { domain, urlPattern, title, description, tags } = args;

    if (!domain) {
      return {
        content: [{ type: 'text', text: '### Error\nMissing "domain" parameter.' }],
        isError: true,
      };
    }

    let bareDomain = domain;
    if (/^https?:\/\//.test(domain)) {
      bareDomain = extractDomain(domain);
    }

    const pattern = urlPattern || '/*';
    const existing = await this._store.getConfigForDomainAndPattern(bareDomain, pattern);
    if (existing) {
      return {
        content: [{ type: 'text', text: `### Config Already Exists\n- **ID**: ${existing.id}\n- **Domain**: ${existing.domain}\n- **URL Pattern**: ${existing.url_pattern}\n- **Title**: ${existing.title}\n\nUse this configId with add_tool to add tools.` }],
      };
    }

    try {
      const config = await this._store.createConfig({
        domain: bareDomain,
        urlPattern: pattern,
        title: title || bareDomain,
        description: description || '',
        tags: tags || null,
      });

      if (bareDomain === this._registry.currentDomain) {
        await this._registry.refreshCurrentConfigs();
      }

      return {
        content: [{ type: 'text', text: `### Config Created\n- **configId**: ${config.id}\n- **Domain**: ${config.domain}\n- **URL Pattern**: ${config.url_pattern}\n- **Title**: ${config.title}\n\nNow use \`add_tool({ configId: "${config.id}", ... })\` to add tools to this config.` }],
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: `### Error creating config\n${String(e.message || e)}` }],
        isError: true,
      };
    }
  }

  // ─── add_tool ───

  async _handleAddTool(args) {
    const { configId, name, description, inputSchema: inputSchemaJson, execution: executionJson } = args;

    if (!configId || !name) {
      return {
        content: [{ type: 'text', text: '### Error\nBoth "configId" and "name" are required.' }],
        isError: true,
      };
    }

    const config = await this._store.getConfigById(configId);
    if (!config) {
      return {
        content: [{ type: 'text', text: `### Error\nConfig "${configId}" not found. Use add_create-config first.` }],
        isError: true,
      };
    }

    let inputSchema = [];
    let execution = {};
    try {
      if (inputSchemaJson) inputSchema = JSON.parse(inputSchemaJson);
    } catch (e) {
      return {
        content: [{ type: 'text', text: `### Error parsing inputSchema JSON\n${String(e)}` }],
        isError: true,
      };
    }
    try {
      if (executionJson) execution = JSON.parse(executionJson);
    } catch (e) {
      return {
        content: [{ type: 'text', text: `### Error parsing execution JSON\n${String(e)}` }],
        isError: true,
      };
    }

    const warnings = [];
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name) && !name.startsWith('x:')) {
      warnings.push(`**Name format**: "${name}" should be kebab-case verb-noun, e.g., "search-products", "fill-login".`);
    }

    if (execution.fields && execution.fields.length > 0 && (!inputSchema || inputSchema.length === 0)) {
      warnings.push(`**Parameterization**: Tool has ${execution.fields.length} field(s) but no params in inputSchema.`);
    }

    let warningText = '';
    if (warnings.length > 0) {
      warningText = `\n\n### Suggestions\n${warnings.map(w => `- ${w}`).join('\n')}`;
    }

    try {
      const tool = await this._store.addTool({
        configId,
        name,
        description: description || '',
        inputSchema,
        execution,
      });

      if (config.domain === this._registry.currentDomain) {
        await this._registry.refreshCurrentTools();
      }

      const isFormTool = (execution.fields?.length > 0) || !!execution.submit;
      const isExtractionTool = !!execution.resultSelector;
      if (isFormTool) this._fallback.savedToolCategories.add('form');
      if (isExtractionTool) this._fallback.savedToolCategories.add('extraction');

      let followUp = '';
      if (isFormTool && !isExtractionTool && this._fallback.everUsed) {
        followUp = `\n\n**Tool is INCOMPLETE** — no resultSelector. Use add_update-tool({ toolName: "${tool.name}" }) to add resultSelector and resultType.`;
      }

      return {
        content: [{ type: 'text', text: `### Tool Added\n- **toolId**: ${tool.id}\n- **Name**: ${tool.name}\n- **Config**: ${config.title} (${config.domain})\n- **Has extraction**: ${isExtractionTool ? 'yes' : '**NO — incomplete**'}\n- **Params**: ${(inputSchema || []).map(p => p.name).join(', ') || 'none'}\n\nThis tool is now available via \`xbot_execute({ toolName: "${tool.name}", args: {...} })\` on ${config.domain}.${followUp}${warningText}` }],
      };
    } catch (e) {
      const errMsg = e.message || String(e);
      if (errMsg.includes('uq_tools_config_name')) {
        return {
          content: [{ type: 'text', text: `### Error\nA tool named "${name}" already exists in this config. Use add_update-tool to modify it, or choose a different name.` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: `### Error adding tool\n${errMsg}${warningText}` }],
        isError: true,
      };
    }
  }

  // ─── add_update-tool ───

  async _handleUpdateTool(args) {
    const { toolName, domain, newName, description, inputSchema: inputSchemaJson, execution: executionJson } = args;

    if (!toolName) {
      return {
        content: [{ type: 'text', text: '### Error\nMissing "toolName" parameter.' }],
        isError: true,
      };
    }

    const searchDomain = domain || this._registry.currentDomain;
    let existing = null;
    if (searchDomain) {
      existing = await this._store.findToolByNameForDomain(searchDomain, toolName);
    }
    if (!existing) {
      existing = await this._store.findToolByName(toolName);
    }
    if (!existing) {
      return {
        content: [{ type: 'text', text: `### Error\nTool "${toolName}" not found${searchDomain ? ` for domain "${searchDomain}"` : ''}. Navigate to the site first or specify the domain.` }],
        isError: true,
      };
    }

    const updates = {};
    if (newName !== undefined) updates.name = newName;
    if (description !== undefined) updates.description = description;

    if (inputSchemaJson !== undefined) {
      try {
        updates.inputSchema = JSON.parse(inputSchemaJson);
      } catch (e) {
        return {
          content: [{ type: 'text', text: `### Error parsing inputSchema JSON\n${String(e)}` }],
          isError: true,
        };
      }
    }

    if (executionJson !== undefined) {
      try {
        updates.execution = JSON.parse(executionJson);
      } catch (e) {
        return {
          content: [{ type: 'text', text: `### Error parsing execution JSON\n${String(e)}` }],
          isError: true,
        };
      }
    }

    try {
      const updated = await this._store.updateTool(existing.id, updates);

      if (this._registry.currentDomain) {
        await this._registry.refreshCurrentTools();
      }

      return {
        content: [{ type: 'text', text: `### Tool Updated\n- **Name**: ${updated.name}\n- **Domain**: ${existing.domain}\n\nChanges saved successfully.` }],
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: `### Error updating tool\n${e.message || String(e)}` }],
        isError: true,
      };
    }
  }

  // ─── add_delete-tool ───

  async _handleDeleteTool(args) {
    const { toolName, domain } = args;

    if (!toolName) {
      return {
        content: [{ type: 'text', text: '### Error\nMissing "toolName" parameter.' }],
        isError: true,
      };
    }

    const searchDomain = domain || this._registry.currentDomain;
    let tool = null;
    if (searchDomain) {
      tool = await this._store.findToolByNameForDomain(searchDomain, toolName);
    }
    if (!tool) {
      tool = await this._store.findToolByName(toolName);
    }
    if (!tool) {
      return {
        content: [{ type: 'text', text: `### Error\nTool "${toolName}" not found${searchDomain ? ` for domain "${searchDomain}"` : ''}. Navigate to the site first or specify the domain.` }],
        isError: true,
      };
    }

    const deleted = await this._store.deleteTool(tool.id);
    if (!deleted) {
      return {
        content: [{ type: 'text', text: `### Error\nFailed to delete tool "${toolName}".` }],
        isError: true,
      };
    }

    if (this._registry.currentDomain) {
      await this._registry.refreshCurrentTools();
    }

    return {
      content: [{ type: 'text', text: `### Deleted\nTool "${toolName}" removed from ${tool.domain}.` }],
    };
  }

  _handleScoreVirality(args) {
    const result = scoreVirality(args)
    return {
      content: [{ type: 'text', text: `### Virality Score: ${result.score} (${result.rating})\n${result.reasoning}\n\n**Breakdown:** ${JSON.stringify(result.breakdown)}` }],
    }
  }

  async serverClosed(server) {
    // Save session state before shutdown
    if (this._sessionFile && this._inner._context) {
      await saveSession(this._inner._context, this._sessionFile);
    }
    this._inner.serverClosed(server);
  }
}

// ─── Constants ───

const MAX_RESULT_CHARS = 40000;

// ─── Helpers ───

function appendTextToResult(result, text) {
  const content = [...(result.content || [])];
  const lastIdx = content.length - 1;
  if (lastIdx >= 0 && content[lastIdx].type === 'text') {
    content[lastIdx] = { ...content[lastIdx], text: content[lastIdx].text + text };
  } else {
    content.push({ type: 'text', text });
  }
  return { ...result, content };
}

function prependTextToResult(result, text) {
  const content = [...(result.content || [])];
  if (content.length > 0 && content[0].type === 'text') {
    content[0] = { ...content[0], text: text + content[0].text };
  } else {
    content.unshift({ type: 'text', text });
  }
  return { ...result, content };
}

function summarizeArgs(toolName, args) {
  if (!args || Object.keys(args).length === 0) return '';
  switch (toolName) {
    case 'browser_click':
      return `ref: "${args.ref}"${args.element ? `, element: "${args.element}"` : ''}`;
    case 'browser_type':
      return `ref: "${args.ref}", text: "${args.text}"${args.submit ? ', submit: true' : ''}`;
    case 'browser_fill_form':
      if (args.fields) {
        const fields = args.fields.map(f => `${f.name || '?'}="${f.value}"`).join(', ');
        return `fields: [${fields}]`;
      }
      return JSON.stringify(args);
    case 'browser_select_option':
      return `ref: "${args.ref}", values: ${JSON.stringify(args.values)}`;
    case 'browser_press_key':
      return `key: "${args.key}"`;
    case 'browser_hover':
      return `ref: "${args.ref}"`;
    default: {
      const json = JSON.stringify(args);
      return json.length > 100 ? json.slice(0, 97) + '...' : json;
    }
  }
}

function postProcessBriefing(raw, maxTokens) {
  if (!raw) return '';
  const charLimit = maxTokens * 4;
  const stripped = raw.replace(/[#*`_~[\]]/g, '').trim();
  if (stripped.length === 0) return '';
  return stripped.length > charLimit
    ? stripped.slice(0, charLimit) + '... [truncated]'
    : stripped;
}

function extractFinalUrl(result) {
  if (!result?.content) return null;
  for (const item of result.content) {
    if (item.type !== 'text') continue;
    const match = item.text.match(/- Page URL:\s*(https?:\/\/\S+)/);
    if (match) return match[1];
  }
  return null;
}

function truncateResult(result) {
  if (!result?.content) return result;

  let totalSize = 0;
  for (const item of result.content) {
    if (item.type === 'text') {
      totalSize += item.text.length;
    } else {
      totalSize += JSON.stringify(item).length;
    }
  }

  if (totalSize <= MAX_RESULT_CHARS) return result;

  const content = [];
  let budget = MAX_RESULT_CHARS;

  for (const item of result.content) {
    if (item.type === 'image') continue;

    if (item.type !== 'text') {
      const itemSize = JSON.stringify(item).length;
      if (budget - itemSize < 0) continue;
      content.push(item);
      budget -= itemSize;
      continue;
    }

    if (item.text.length <= budget) {
      content.push(item);
      budget -= item.text.length;
    } else if (budget > 500) {
      const truncPoint = item.text.lastIndexOf('\n', budget);
      const cutAt = truncPoint > budget * 0.5 ? truncPoint : budget;
      const truncated = item.text.slice(0, cutAt);
      const droppedChars = item.text.length - cutAt;

      content.push({
        ...item,
        text: truncated + `\n\n--- Content truncated (${Math.round(droppedChars / 1024)}KB omitted). Take another snapshot or use resultSelector in saved tools to extract specific data. ---`,
      });
      budget = 0;
    }
  }

  return { ...result, content };
}

module.exports = { XbotBackend };
