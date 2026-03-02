'use strict';

// Tools that are "read-only" and should NOT trigger save nudges
const READ_ONLY_FALLBACK_TOOLS = new Set([
  'browser_snapshot',
  'browser_console_messages',
  'browser_network_requests',
  'browser_tabs',
  'browser_take_screenshot',
]);

class FallbackTracker {
  constructor() {
    this.nudgePending = false;
    this.everUsed = false;
    this.extractionHintShown = false;
    this.toolsUsed = [];
    this.actionLog = [];
    this.savedToolCategories = new Set();
  }

  reset() {
    this.nudgePending = false;
    this.everUsed = false;
    this.extractionHintShown = false;
    this.toolsUsed = [];
    this.actionLog = [];
    this.savedToolCategories = new Set();
  }

  trackFallbackUse(toolName, args) {
    if (READ_ONLY_FALLBACK_TOOLS.has(toolName)) return false;
    this.nudgePending = true;
    this.everUsed = true;
    if (!this.toolsUsed.includes(toolName)) {
      this.toolsUsed.push(toolName);
    }
    this.actionLog.push({ tool: toolName, args });
    return true;
  }

  isReadOnly(toolName) {
    return READ_ONLY_FALLBACK_TOOLS.has(toolName);
  }

  buildSaveNudge(domain, currentTools, currentConfigs) {
    const hasExistingTools = currentTools.length > 0;

    let nudge = `<save-reminder>\n`;
    nudge += `You have used browser_fallback to interact with this page.\n`;
    nudge += `You are NOT done yet. Before finishing, complete this checklist:\n\n`;

    if (this.actionLog.length > 0) {
      nudge += `Steps you performed:\n`;
      for (let i = 0; i < this.actionLog.length; i++) {
        const entry = this.actionLog[i];
        nudge += `  ${i + 1}. ${entry.tool}(${entry.args})\n`;
      }
      nudge += `\n`;
    }

    if (hasExistingTools) {
      const existingNames = currentTools.map(t => t.name).join(', ');
      nudge += `Existing tools for ${domain}: ${existingNames}\n`;
      nudge += `→ If these don't cover what you just did, save a new tool. Do NOT duplicate existing ones.\n\n`;
    }

    const hasConfigs = currentConfigs.length > 0;
    nudge += `Checklist — complete ALL before saying you are done:\n`;
    if (!hasConfigs) {
      nudge += `  [ ] Call add_create-config for "${domain}"\n`;
    }
    nudge += `  [ ] Call add_tool with a COMPLETE tool covering the steps above\n`;
    nudge += `  [ ] Include "fields" for form inputs (parameterize all user-changeable values in input_schema)\n`;
    nudge += `  [ ] Include "submit" for form submission\n`;
    nudge += `  [ ] Include "waitFor" to wait for results to load\n`;
    nudge += `  [ ] Include "resultSelector" + "resultType" for data extraction\n`;
    nudge += `  [ ] Use kebab-case verb-noun name (e.g., "search-google")\n`;
    nudge += `\n`;
    nudge += `Only then is your task complete.\n`;
    nudge += `</save-reminder>`;

    return nudge;
  }

  buildFallbackListReminder(domain, currentTools) {
    const hasExistingTools = currentTools.length > 0;

    if (hasExistingTools) {
      const toolList = currentTools.map(t => t.name).join(', ');
      return `\n\n<reminder>Saved tools exist for ${domain}: ${toolList}
Use xbot_execute instead of browser_fallback when possible.
Any use of browser_fallback requires saving a complete tool before you are done.</reminder>`;
    } else if (domain) {
      return `\n\n<reminder>No saved tools for ${domain}. Use browser_fallback to complete the task first.</reminder>`;
    }
    return '';
  }

  buildSaveReminder(toolName) {
    return `\n\n<save-reminder>
You used browser_fallback (${toolName}). You are NOT done yet.
Before saying you are done, you MUST save a complete tool:
  1. add_create-config (if no config exists yet)
  2. add_tool with fields + submit + resultSelector + input_schema params
An tool without resultSelector is INCOMPLETE.
</save-reminder>`;
  }
}

module.exports = { FallbackTracker, READ_ONLY_FALLBACK_TOOLS };
