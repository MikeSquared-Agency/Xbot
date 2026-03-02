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

const playwrightMcpDir = path.dirname(require.resolve('playwright/lib/mcp/program'));
const { resolveConfig } = require(path.join(playwrightMcpDir, 'browser', 'config'));
const { contextFactory } = require(path.join(playwrightMcpDir, 'browser', 'browserContextFactory'));
const mcpServer = require(path.join(playwrightMcpDir, 'sdk', 'server'));

const { XbotBackend } = require('./src/xbot-backend');
const packageJSON = require('./package.json');

async function createConnection(userConfig = {}, contextGetter) {
  const config = await resolveConfig(userConfig);
  let factory;
  if (contextGetter) {
    factory = {
      name: 'custom',
      description: 'Connect to a browser using a custom context getter',
      createContext: async () => {
        const browserContext = await contextGetter();
        return { browserContext, close: () => browserContext.close() };
      },
    };
  } else {
    factory = contextFactory(config);
  }
  return mcpServer.createServer(
    'Xbot Browser',
    packageJSON.version,
    new XbotBackend(config, factory),
    false
  );
}

module.exports = { createConnection };
