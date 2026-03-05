'use strict';

const { z } = require('playwright-core/lib/mcpBundle');

// ─── Core Tools ───

const xbotExecuteSchema = {
  name: 'xbot_execute',
  title: 'Execute a saved tool',
  description: `Execute a pre-configured tool for the current site.
<usage-rules>
- After navigating to a site, the response tells you which tools exist.
- Call this with the toolName and arguments to execute them.
- These are saved shortcuts that use CSS selectors instead of raw Playwright calls.
- ALWAYS prefer xbot_execute over browser_fallback when a saved tool exists for your task.
</usage-rules>`,
  inputSchema: z.object({
    toolName: z.string().describe('The tool name to execute (e.g., "search-products")'),
    args: z.record(z.string(), z.unknown()).optional().describe('Arguments for the tool, matching its input_schema definition'),
  }),
  type: 'action',
};

const browserFallbackSchema = {
  name: 'browser_fallback',
  title: 'Raw Playwright tool',
  description: `A gateway to the full upstream Playwright MCP toolset. Works in three modes:
- No arguments: lists all available Playwright tools
- peek: true: inspects a tool's full input schema before calling it
- tool + arguments: executes a Playwright tool (e.g. browser_click, browser_snapshot)

This is your escape hatch when saved tools don't cover what you need.
<workflow>
1. First check if saved tools exist after browser_navigate.
2. If a saved tool exists, use xbot_execute instead.
3. If no saved tool exists, use this tool to complete the task.
4. After completing the task with fallback tools, ALWAYS save the workflow using add_tool.
</workflow>
<important>
All element-targeting tools use "ref" values from browser_snapshot (e.g., "e12", "e37"), NOT CSS selectors.
Always take a browser_snapshot first to get element refs, then use those refs in tool calls.
If you get a validation error, the correct schema will be included in the error response.
</important>
<tool-schemas>
Common tools — use EXACTLY these argument shapes:

browser_click:       { "ref": "e12" }                         — ref from snapshot, NOT a selector
browser_type:        { "ref": "e12", "text": "hello" }        — ref from snapshot + text to type
browser_press_key:   { "key": "Enter" }                       — key name
browser_hover:       { "ref": "e12" }                         — ref from snapshot
browser_select_option: { "ref": "e12", "values": ["opt1"] }   — ref + values array
browser_fill_form:   { "fields": [{"ref":"e12","value":"hi"},{"ref":"e15","value":"there"}] }  — array of {ref, value} objects

WRONG: { "selector": "...", "text": "..." }   — never use "selector", always use "ref"
WRONG: { "searchText": {...} }                — no such parameter exists
</tool-schemas>`,
  inputSchema: z.object({
    tool: z.string().describe('The Playwright tool name (e.g., "browser_click", "browser_fill_form")'),
    peek: z.boolean().optional().describe('Set to true to inspect the tool\'s input schema without executing it'),
    arguments: z.record(z.string(), z.unknown()).optional().describe('Arguments for the tool'),
  }),
  type: 'action',
};

// ─── Contribution Tools ───

const addCreateConfigSchema = {
  name: 'add_create-config',
  title: 'Create a config',
  description: `Creates a new config for a given domain/URL pattern. Returns a configId that you use with add_tool to add tools to it.
<rules>
- DOMAIN: Use bare domain like "amazon.com", NOT "https://www.amazon.com".
- URL_PATTERN: Use glob patterns like "/*" (all pages), "/dp/*" (product pages), "/search*" (search). Defaults to "/*".
- TITLE: Short human-readable name for this config (max 200 chars).
- DESCRIPTION: What this config covers (max 5000 chars).
</rules>`,
  inputSchema: z.object({
    domain: z.string().describe('Bare domain (e.g., "amazon.com")'),
    urlPattern: z.string().optional().describe('URL path glob pattern (e.g., "/*", "/dp/*"). Defaults to "/*".'),
    title: z.string().describe('Short title for this config (e.g., "Amazon Product Pages")'),
    description: z.string().optional().describe('Description of what this config covers'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
  }),
  type: 'action',
};

const addToolSchema = {
  name: 'add_tool',
  title: 'Add a tool to a config',
  description: `Adds a tool definition to an existing config. You define CSS selectors, form fields, result extraction strategies, submit actions, and more.
<rules>
- COMPLETE TOOLS: Every tool that produces visible results MUST include a resultSelector to extract data. A tool without extraction is INCOMPLETE.
- GENERALIZE: Every value the user might change next time MUST be a param in input_schema. Never hardcode search terms, usernames, quantities.
- KEEP SELECTORS: CSS selectors, roles, and testIds stay hardcoded — they are structural, not user data.
- NAMING: Use kebab-case verb-noun format for name: "search-products", "extract-price", "fill-login".
</rules>
<example-search>
{
  "configId": "uuid-from-add_create-config",
  "name": "search-products",
  "description": "Search for products by keyword",
  "inputSchema": [
    { "name": "query", "type": "string", "description": "Search term", "required": true }
  ],
  "execution": {
    "fields": [
      { "selector": "#twotabsearchtextbox", "param": "query" }
    ],
    "submit": { "selector": "#nav-search-submit-button" },
    "waitFor": ".s-main-slot",
    "resultSelector": ".s-result-item",
    "resultType": "list"
  }
}
</example-search>
<example-extraction>
Extract data — no user input needed, just reads the page:
{
  "configId": "uuid-from-add_create-config",
  "name": "extract-product-info",
  "description": "Extract product title and price",
  "inputSchema": [],
  "execution": {
    "resultSelector": "#productTitle",
    "resultType": "single"
  }
}
</example-extraction>
<extraction-modes>
resultExtract modes (overrides resultType when set):
- "text": Single element's textContent (default)
- "list": All matching elements' textContent as array
- "html": Single element's innerHTML
- "attribute": Single element's attribute (specify with resultAttribute)
- "table": Parse HTML table into array of row objects
- "innerText": Single element's innerText (respects CSS visibility)
- "innerTextList": All matching elements' innerText as array
</extraction-modes>
<field-types>
Supported field types:
- "fill" (default) / "text" / "textarea" / "number" / "date": Native Playwright fill
- "select": Dropdown select
- "check" / "checkbox": Checkbox toggle
- "radio": Radio button
- "click": Click element
</field-types>`,
  inputSchema: z.object({
    configId: z.string().describe('The config ID to add this tool to (from add_create-config)'),
    name: z.string().describe('Kebab-case tool name (e.g., "search-products")'),
    description: z.string().describe('What this tool does'),
    inputSchema: z.string().describe('JSON string of params array: [{ name, type, description, required, default }]'),
    execution: z.string().describe('JSON string of execution definition: { fields, submit, waitFor, resultSelector, resultType }'),
  }),
  type: 'action',
};

const addUpdateToolSchema = {
  name: 'add_update-tool',
  title: 'Update a tool',
  description: `Updates an existing tool in a config — fix broken selectors, change descriptions, tweak extraction logic, etc.
Provide the tool name and only the fields you want to update. Uses the current domain to find the tool.`,
  inputSchema: z.object({
    toolName: z.string().describe('The tool name to update (e.g., "search-products")'),
    domain: z.string().optional().describe('Domain to search in. Defaults to current domain.'),
    newName: z.string().optional().describe('New tool name'),
    description: z.string().optional().describe('New description'),
    inputSchema: z.string().optional().describe('New JSON string of params array'),
    execution: z.string().optional().describe('New JSON string of execution definition'),
  }),
  type: 'action',
};

const xbotMemorySearchSchema = {
  name: 'xbot_memory',
  title: 'Search memory for saved sites and tools',
  description: `Search your memory of previously visited sites and saved tools by natural language query.
<usage-rules>
- Use this when the user wants something but you don't know which site to go to.
- Use this when no saved tools exist for the current page.
- Returns matching sites with their descriptions and available tools.
- After getting results, use browser_navigate to go to the relevant site.
</usage-rules>`,
  inputSchema: z.object({
    query: z.string().describe('Natural language description of what the user wants (e.g., "order food", "book a flight", "search for products")'),
  }),
  type: 'readOnly',
};

const addDeleteToolSchema = {
  name: 'add_delete-tool',
  title: 'Delete a tool',
  description: 'Removes a tool from a config entirely. Uses the current domain to find the tool by name.',
  inputSchema: z.object({
    toolName: z.string().describe('The tool name to delete (e.g., "search-google")'),
    domain: z.string().optional().describe('Domain to search in. Defaults to current domain.'),
  }),
  type: 'action',
};

const scoreViralitySchema = {
  name: 'score_virality',
  title: 'Score tweet virality',
  description: `Calculate a virality score for a tweet candidate based on X algorithm weights.
Returns a score, rating (high/medium/low/skip), reasoning, and breakdown.
Uses reply (13.5x), retweet (20x), bookmark (10x), like (1x) weights with exponential time decay (50% per 6h).`,
  inputSchema: z.object({
    replies: z.number().describe('Number of replies'),
    retweets: z.number().describe('Number of retweets/reposts'),
    likes: z.number().describe('Number of likes'),
    bookmarks: z.number().optional().describe('Number of bookmarks'),
    views: z.number().optional().describe('Number of views/impressions'),
    age_hours: z.number().describe('Tweet age in hours'),
    author_followers: z.number().optional().describe('Author follower count'),
    author_replies_back: z.boolean().optional().describe('Whether the author typically replies back to replies'),
  }),
  type: 'readOnly',
};

module.exports = {
  xbotExecuteSchema,
  browserFallbackSchema,
  xbotMemorySearchSchema,
  addCreateConfigSchema,
  addToolSchema,
  addUpdateToolSchema,
  addDeleteToolSchema,
  scoreViralitySchema,
};
