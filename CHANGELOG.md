# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-03-14

### Added
- First-class `browser_console`, `browser_network`, and `browser_screenshot` MCP tools for direct observability without `browser_fallback`
- Compact snapshot mode: `browser_snapshot` accepts `mode` parameter (`full`, `compact`, `interactive`) reducing token usage by ~90%
- `jsonOnly` filter on `browser_network` for extracting API response data
- Automatic selector learning: fallback selectors auto-promoted to primary on success
- Auto-generated fallback selectors when saving tools via `add_tool`
- Workflow `assertVisible` step for conditional element checks
- Workflow `if` step for branching with `then`/`else` blocks
- Workflow `retry` step with configurable attempts and delay
- Fingerprint masking: `navigator.webdriver`, plugins, `chrome.runtime` spoofing
- Human-like Bezier curve mouse movement via `humanLike: true` on click steps
- User-agent rotation pool (5 real Chrome UA strings, random per-session)
- Comprehensive unit test suite for new features

### Changed
- Refactored `translateWorkflow` into `translateStep` for recursive step translation
- Anti-detection module now re-exports fingerprint utilities
