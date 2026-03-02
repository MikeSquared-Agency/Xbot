#!/usr/bin/env node
/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const path = require('path');
const { program } = require('playwright-core/lib/utilsBundle');
const { decorateMCPCommand } = require('playwright/lib/mcp/program');

// Internal Playwright MCP modules (not publicly exported, use resolved paths)
const playwrightMcpDir = path.dirname(require.resolve('playwright/lib/mcp/program'));
const { resolveCLIConfig } = require(path.join(playwrightMcpDir, 'browser', 'config'));
const { contextFactory } = require(path.join(playwrightMcpDir, 'browser', 'browserContextFactory'));
const { setupExitWatchdog } = require(path.join(playwrightMcpDir, 'browser', 'watchdog'));
const { ExtensionContextFactory } = require(path.join(playwrightMcpDir, 'extension', 'extensionContextFactory'));
const mcpServer = require(path.join(playwrightMcpDir, 'sdk', 'server'));

const { XbotBackend } = require('./src/xbot-backend');
const { loadSession } = require('./src/browser/session');
const packageJSON = require('./package.json');

const p = program.version('Version ' + packageJSON.version).name('Xbot Browser');

// Let decorateMCPCommand add all CLI options and the default action handler
decorateMCPCommand(p, packageJSON.version);

// Add custom options
p.option('--session-file <path>', 'Path to browser session file for persistent login state');

// Override the action handler to use XbotBackend instead of BrowserServerBackend
p.action(async (options) => {
  options.sandbox = options.sandbox === true ? undefined : false;
  setupExitWatchdog();

  if (options.vision) {
    console.error('The --vision option is deprecated, use --caps=vision instead');
    options.caps = 'vision';
  }
  if (options.caps?.includes('tracing'))
    options.caps.push('devtools');

  const config = await resolveCLIConfig(options);

  // Load session state if provided
  if (options.sessionFile) {
    loadSession(config, options.sessionFile);
  }

  if (config.extension) {
    const extensionContextFactory = new ExtensionContextFactory(
      config.browser.launchOptions.channel || 'chrome',
      config.browser.userDataDir,
      config.browser.launchOptions.executablePath
    );
    const factory = {
      name: 'Xbot Browser (Extension)',
      nameInConfig: 'xbot-browser',
      version: packageJSON.version,
      create: () => new XbotBackend(config, extensionContextFactory, { sessionFile: options.sessionFile }),
    };
    await mcpServer.start(factory, config.server);
    return;
  }

  const browserContextFactory = contextFactory(config);
  const factory = {
    name: 'Xbot Browser',
    nameInConfig: 'xbot-browser',
    version: packageJSON.version,
    create: () => new XbotBackend(config, browserContextFactory, { sessionFile: options.sessionFile }),
  };

  await mcpServer.start(factory, config.server);
});

void program.parseAsync(process.argv);
