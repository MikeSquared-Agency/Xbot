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

import { test, expect } from './fixtures';

test('test snapshot tool list', async ({ client }) => {
  const { tools } = await client.listTools();
  const toolNames = new Set(tools.map(t => t.name));
  // Xbot exposes its own MCP tool surface (not raw Playwright tools)
  expect(toolNames).toContain('browser_navigate');
  expect(toolNames).toContain('browser_snapshot');
  expect(toolNames).toContain('browser_snapshot_diff');
  expect(toolNames).toContain('browser_console');
  expect(toolNames).toContain('browser_network');
  expect(toolNames).toContain('browser_screenshot');
  expect(toolNames).toContain('browser_fallback');
  expect(toolNames).toContain('xbot_execute');
  expect(toolNames).toContain('xbot_memory');
  expect(toolNames).toContain('add_create-config');
  expect(toolNames).toContain('add_tool');
  expect(toolNames).toContain('add_update-tool');
  expect(toolNames).toContain('add_delete-tool');
  expect(toolNames).toContain('score_virality');
});

test('test capabilities (pdf)', async ({ startClient }) => {
  const { client } = await startClient({
    args: ['--caps=pdf'],
  });
  const { tools } = await client.listTools();
  const toolNames = tools.map(t => t.name);
  expect(toolNames).toContain('browser_pdf_save');
});

test('test capabilities (vision)', async ({ startClient }) => {
  const { client } = await startClient({
    args: ['--caps=vision'],
  });
  const { tools } = await client.listTools();
  const toolNames = tools.map(t => t.name);
  expect(toolNames).toContain('browser_mouse_move_xy');
  expect(toolNames).toContain('browser_mouse_click_xy');
  expect(toolNames).toContain('browser_mouse_drag_xy');
});

test('support for legacy --vision option', async ({ startClient }) => {
  const { client } = await startClient({
    args: ['--vision'],
  });
  const { tools } = await client.listTools();
  const toolNames = tools.map(t => t.name);
  expect(toolNames).toContain('browser_mouse_move_xy');
  expect(toolNames).toContain('browser_mouse_click_xy');
  expect(toolNames).toContain('browser_mouse_drag_xy');
});
