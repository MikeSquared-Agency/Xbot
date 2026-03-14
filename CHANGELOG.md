# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-03-14

### Added
- `browser_snapshot_diff` MCP tool — returns only lines that changed since the last snapshot (added/removed), drastically reducing token usage after actions
- Snapshot depth limiting — `browser_snapshot({ depth: N })` limits ARIA tree depth for large pages
- Snapshot selector scoping — `browser_snapshot({ selector: "#main" })` scopes snapshot to a specific DOM element
- Content boundary markers — all page-derived content wrapped in `--- PAGE CONTENT START/END ---` markers to prevent prompt injection
- Configurable output length limits — `XBOT_MAX_OUTPUT` env var and per-call `maxLength` parameter
- Auto-save session persistence — browser cookies and localStorage auto-saved after navigations and actions with debounced writes
- Extensive test suite: integration tests for all new features, expanded unit tests for diff, depth limiting, auto-save, and boundary markers

### Changed
- `truncateResult` now accepts configurable limit parameter; truncation message shortened to `[...truncated, N more chars]`
- `browser_snapshot` schema expanded with `depth`, `selector`, and `maxLength` parameters
- Session shutdown uses auto-saver flush instead of manual save

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
