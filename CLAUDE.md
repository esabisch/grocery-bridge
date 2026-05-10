# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chrome MV3 extension that pulls a Todoist project's tasks and adds each one to a Walmart list by driving the Walmart DOM from inside the user's real, logged-in Chrome session. There is no headless-browser path — the deliberate design choice is to look like a human to Walmart's bot detection.

## Dev loop

There is no build, bundler, package manager, or test suite. The repo is loaded directly by Chrome.

- Install: `chrome://extensions/` → Developer mode → **Load unpacked** → select repo root.
- After editing any file: hit the reload icon for "Grocery Bridge" on `chrome://extensions/`. Module changes do not hot-reload.
- Service worker logs: `chrome://extensions/` → **service worker** link under the extension card.
- Content-script logs: regular DevTools on the active walmart.com tab. All Walmart-DOM logging is `console.debug` and prefixed `[gb]`.
- Popup logs: right-click extension icon → **Inspect popup**.

To exercise the flow without mutating Walmart, tick **Dry run** in the popup confirm screen — URL resolution still happens, the add step is skipped.

## Architecture

Four surfaces, talking via `chrome.runtime.sendMessage` and `chrome.storage`:

- **`popup/`** — resolves the Todoist project, fuzzy-matches each item against the SKU map (`lib/sku-match.js`, threshold 88), shows the confirm screen, sends `start_queue` to the SW. Also renders the picker UI when the SW is `awaiting_pick` and the last-run report.
- **`background/service-worker.js`** — owns the queue. Drives `chrome.tabs.update` to navigate the Walmart tab to each item's `target_url`, waits for `chrome.tabs.onUpdated` `status: "complete"`, then `chrome.scripting.executeScript`s `lib/walmart-dom.js` + `content/walmart.js` and sends `process_current`. Handles challenged/need_pick/added/failed outcomes and advances the cursor.
- **`content/walmart.js`** — programmatically injected per page load (not declared in manifest). Reads `location.pathname` to decide between `/search` (return up to 3 candidates) and `/ip/` (call `addToList`). Reports back to the SW via `sendResponse`.
- **`lib/walmart-dom.js`** — plain script (NOT an ES module), exposes `globalThis.GB_DOM`. All Walmart selectors and click flows live here. When Walmart redesigns a page, this is the **only** file to patch.

### Service-worker invariants

The MV3 SW is terminated between events. Two non-obvious rules in `service-worker.js`:

1. **No module-scope state.** Queue, cursor, status, dryRun, tabId all live in `chrome.storage.session` (see `lib/state.js` `SESS_KEYS`). Anything stashed in a module variable will be lost on SW wake.
2. **All listeners register at top level** so they re-attach on every SW wake. Don't move `chrome.runtime.onMessage` / `chrome.tabs.onUpdated` / `chrome.alarms.onAlarm` registrations into async functions.

### Storage layout (3 tiers, intentional)

- `chrome.storage.session` — live queue state (queue, cursor, status, tabId, dryRun, pick candidates). Cleared on browser restart.
- `chrome.storage.local` — Todoist token, cached project id, last-run report. Per-device.
- `chrome.storage.sync` — SKU map under `sku:<lowercased name>` keys, synced across the user's Chromes. Built up organically as the user picks unmapped items.

All access goes through `lib/state.js`. The content script does **not** import this module — it's loaded as a plain file via `chrome.scripting.executeScript` and only knows `GB_DOM`.

### Module vs plain-script split

- ES modules (`type: "module"` in manifest, or `import` in popup/options HTML): `background/service-worker.js`, `popup/popup.js`, `options/options.js`, `lib/state.js`, `lib/todoist.js`, `lib/sku-match.js`.
- Plain scripts (executeScript-injected, IIFE that attaches to `globalThis`): `lib/walmart-dom.js`, `content/walmart.js`.

If you add a `lib/` helper that the content script needs, it must be a plain script too — content scripts can't `import`.

### Challenge handling

`GB_DOM.detectChallenge()` returns true for `/blocked`, "robot or human" titles, or "press and hold" body text. When the SW receives `challenged`, it sets status `paused_challenge`, fires a notification, and starts a `chrome.alarms` poll (`gb-challenge-recheck`, 30s) **as a fallback only** — the primary resume trigger is `chrome.tabs.onUpdated` firing `status: "complete"` after the user solves the challenge. On resume the SW re-injects scripts and re-issues the navigation to the current item's `target_url`.

### Tab-aware abort

`chrome.tabs.onUpdated` aborts the run if the tracked tab navigates off `walmart.com`. This is intentional — a user clicking away mid-queue should stop the automation, not have it follow them.

## When Walmart changes its DOM

1. Reproduce the failure on a real walmart.com page with the extension running.
2. Open DevTools and watch for `[gb]` logs — `addToList` dumps a `console.table` of dialog candidates when the list-picker entry can't be found.
3. Patch the relevant function in `lib/walmart-dom.js` only. The visible-element filter (`isVisible`) in `findListPickerDialog` is load-bearing — Walmart pre-renders many hidden dialogs and matching the wrong one silently breaks the flow.
4. Reload the extension at `chrome://extensions/`.

## Todoist

`lib/todoist.js` targets `/api/v1` (the older `/rest/v2` is deprecated). Pagination uses `next_cursor`, capped at 50 pages in `paginate()`. The default project name is `Groceries` and the resolved project id is cached in `chrome.storage.local`.
