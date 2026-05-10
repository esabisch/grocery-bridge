# grocery-bridge

Chrome extension that syncs a Todoist grocery list into a Walmart Lists entry,
item by item, from inside your real browser session.

## Why an extension

Walmart aggressively detects browser automation. Driving the same DOM clicks
from inside your real, logged-in Chrome -- via an extension -- bypasses that
entire surface: your fingerprint, IP, cookies, and history are exactly the
ones Walmart already trusts. No headless browsers, no scraping infrastructure,
no anti-bot games.

## Install

1. Clone or download this repo.
2. Open `chrome://extensions/` and enable **Developer mode** (top-right).
3. Click **Load unpacked**, pick the repo directory.
4. The extension is now installed. Find it in the puzzle-piece menu in your
   toolbar; pin it for easy access.

## Setup

1. Get a Todoist API token at
   [todoist.com -> Settings -> Integrations -> Developer](https://todoist.com/app/settings/integrations/developer).
2. In `chrome://extensions/`, click **Details** on Grocery Bridge ->
   **Extension options**.
3. Paste the token, set the Todoist project name (default: `Groceries`), save.
4. In Walmart, create a list with the same name (default: `Groceries`) if it
   doesn't already exist.

## Usage

1. Open `walmart.com` in any tab and sign in if you aren't already.
2. Click the extension icon. The popup pulls your Todoist list and shows what
   it will do for each item:
   - **Mapped item** -> goes direct to a known product page
   - **Unmapped item** -> falls back to Walmart search; you'll be asked to
     pick from the top results, and the mapping is remembered for next time
3. Optionally tick **Dry run** to resolve URLs without actually adding
   anything (useful for debugging selector issues).
4. Hit **Add all to Groceries**. The extension drives the Walmart tab through
   each item. Successfully added items are marked complete in Todoist.

After the run, head to `walmart.com/lists` -> your list -> review and convert
to a cart when you're ready to order. The extension intentionally does not
check out for you.

## Configuration

Most behavior is configurable in the Options page:

- **Todoist token** -- per-device, stored in `chrome.storage.local`.
- **Todoist project name** -- which Todoist project to read items from.
- **Walmart list name** -- which Walmart list to add items to. Must already
  exist in your account.

The SKU map (item-name -> Walmart product URL) lives in `chrome.storage.sync`,
syncing across all your Chromes via your Google account. It builds up
organically as you use the extension; nothing to configure.

## When Walmart redesigns the page

Walmart's DOM changes occasionally and selectors may break. All Walmart
selectors live in [`lib/walmart-dom.js`](./lib/walmart-dom.js) -- one file to
patch. Open DevTools on the relevant Walmart page, find the new selector, edit,
reload the unpacked extension at `chrome://extensions/`. Detailed
`console.debug` logging in `addToList` makes the broken step easy to identify.

## Files

```
manifest.json
popup/         # confirm screen, picker, last-run report
options/       # one-time setup
background/    # MV3 service worker; orchestrates the run queue
content/       # walmart.js, programmatically injected per page navigation
lib/
  state.js       # chrome.storage wrappers
  todoist.js     # /api/v1 client + cursor pagination
  sku-match.js   # fuzzy lookup (Levenshtein + token-sort)
  walmart-dom.js # all Walmart selectors + click flows
```

## Limitations

- **Mobile not supported.** Chrome on iOS/Android doesn't run extensions.
- **Single retailer.** Walmart-only. Other retailers would need their own
  selector module.
- **Bot detection isn't impossible.** While running automation from your real
  browser is dramatically more robust than headless, Walmart can still serve
  a verification challenge ("press and hold"). The extension detects these
  and pauses; you solve it manually, the queue resumes automatically.
- **Doesn't handle quantity.** "3 avocados" in Todoist adds qty=1 to your
  list. Adjust on Walmart's list page after the run.

## License

MIT. See [`LICENSE`](./LICENSE).
