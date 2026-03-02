'use strict';

const { z } = require('playwright-core/lib/mcpBundle');

// --- Selector Schema ---
const selectorObjectSchema = z.object({
  css: z.string().optional().describe('CSS selector'),
  role: z.string().optional().describe('ARIA role (button, textbox, link, etc.)'),
  name: z.string().optional().describe('Accessible name (used with role)'),
  text: z.string().optional().describe('Text content match'),
  testId: z.string().optional().describe('data-testid attribute value'),
  label: z.string().optional().describe('Form field label text'),
  placeholder: z.string().optional().describe('Input placeholder text'),
  hasText: z.string().optional().describe('Filter by contained text'),
  nth: z.number().optional().describe('Index when multiple matches (0-based)'),
});

const selectorSchema = z.union([
  z.string(),
  selectorObjectSchema,
]);

// --- Param Schema ---
const paramSchema = z.object({
  name: z.string().describe('Parameter name'),
  type: z.enum(['string', 'number', 'boolean', 'enum']).describe('Parameter type'),
  description: z.string().optional().describe('Parameter description'),
  required: z.boolean().optional().default(false),
  default: z.any().optional().describe('Default value'),
  enumValues: z.array(z.string()).optional().describe('Allowed values for enum type'),
});

// --- Field Schema ---
const fieldSchema = z.object({
  selector: selectorSchema.describe('Element selector'),
  param: z.string().optional().describe('Parameter name to fill from'),
  name: z.string().optional().describe('Alternative parameter name (alias for param)'),
  type: z.enum([
    'fill', 'select', 'check', 'click',
    'text', 'textarea', 'number', 'date',
    'checkbox', 'radio',
  ]).optional().default('fill'),
  description: z.string().optional().describe('Field description'),
  defaultValue: z.any().optional().describe('Default value for this field'),
  options: z.array(z.object({
    value: z.string(),
    label: z.string().optional(),
    selector: z.string().optional().describe('Override selector for this option (radio buttons)'),
  })).optional().describe('Options for select/radio fields'),
});

// --- Delay Schema ---
const delaySchema = z.object({
  beforeAction: z.number().optional().describe('Delay in ms before each action'),
  afterAction: z.number().optional().describe('Delay in ms after each action'),
  typing: z.number().optional().describe('Delay in ms between keystrokes'),
  scroll: z.number().optional().describe('Delay in ms between scroll actions'),
  jitter: z.number().optional().describe('Random jitter in ms added to delays'),
});

// --- Scroll Schema ---
const scrollSchema = z.object({
  direction: z.enum(['down', 'up']).optional().default('down').describe('Scroll direction'),
  amount: z.number().optional().default(500).describe('Scroll amount in pixels'),
  selector: z.string().optional().describe('Scroll within this element'),
  afterField: z.string().optional().describe('Scroll after filling this field name'),
  afterSubmit: z.boolean().optional().describe('Scroll after form submission'),
});

// --- Execution Schema ---
const executionSchema = z.object({
  fields: z.array(fieldSchema).optional().default([]).describe('Form fields to fill'),
  submit: z.union([
    z.object({ selector: selectorSchema }).describe('Click a submit button'),
    z.object({ key: z.string().describe('Key to press (e.g., "Enter")') }).describe('Press a key to submit'),
  ]).optional().describe('How to submit: click a button OR press a key'),
  autosubmit: z.boolean().optional().describe('Auto-submit after filling fields'),
  submitAction: z.enum(['enter', 'click']).optional().describe('Submit method when autosubmit is true'),
  submitSelector: z.string().optional().describe('Button selector when submitAction is "click"'),
  resultSelector: z.union([z.string(), selectorObjectSchema]).optional().describe('Selector for result elements'),
  resultType: z.enum(['single', 'list']).optional().default('single').describe('Single element or list'),
  resultExtract: z.enum([
    'text', 'list', 'html', 'attribute', 'table',
    'innerText', 'innerTextList',
  ]).optional().describe('Extraction mode. Overrides resultType when set.'),
  resultAttribute: z.string().optional().describe('Attribute name for "attribute" extraction mode'),
  extractAttributes: z.array(z.string()).optional().describe('Attributes to extract from list results'),
  waitFor: selectorSchema.optional().describe('Wait for this element after submit'),
  waitTimeout: z.number().optional().default(10000).describe('Wait timeout in ms'),
  resultWaitSelector: z.string().optional().describe('Wait for this selector before extracting results'),
  resultDelay: z.number().optional().describe('Fixed delay in ms before extraction'),
  resultRequired: z.boolean().optional().describe('If true, throw on wait timeout instead of continuing'),
  selector: z.string().optional().describe('Root element selector'),
  // Anti-detection
  delays: delaySchema.optional().describe('Anti-detection delays'),
  scrolls: z.array(scrollSchema).optional().describe('Scroll actions at specified positions'),
  verifySelector: z.string().optional().describe('Selector to verify after execution succeeded'),
});

// --- Action Schema ---
const actionSchema = z.object({
  id: z.string().describe('Unique action ID within the domain'),
  name: z.string().describe('Human-readable action name'),
  description: z.string().optional().describe('Action description'),
  domain: z.string().describe('Domain this action belongs to'),
  params: z.array(paramSchema).optional().default([]),
  execution: executionSchema,
  urlPatterns: z.array(z.string()).optional().describe('URL patterns where this action is available'),
  stats: z.object({
    runs: z.number().default(0),
    successes: z.number().default(0),
    failures: z.number().default(0),
    lastRun: z.string().optional().describe('ISO timestamp of last execution'),
  }).optional().describe('Execution quality stats'),
});

// --- Domain Config Schema ---
const domainConfigSchema = z.object({
  domain: z.string().describe('Domain name'),
  title: z.string().optional().describe('Page/site title for grouping'),
  pageDescription: z.string().optional().describe('Page/site description for grouping'),
  actions: z.array(actionSchema).describe('Actions for this domain'),
});

module.exports = {
  selectorSchema,
  selectorObjectSchema,
  paramSchema,
  fieldSchema,
  delaySchema,
  scrollSchema,
  executionSchema,
  actionSchema,
  domainConfigSchema,
};
