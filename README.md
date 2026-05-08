# grocery-bridge

Chrome MV3 extension. Pulls a grocery list from Todoist, navigates Walmart in
your real browser, and adds each item to a Walmart "Groceries" list. No server,
no Playwright, no Synology. The automation runs as you, in your tab.

## Why an extension

The original plan was Playwright on a Synology NAS pushing items into a logged-in
Walmart profile. Walmart's Akamai bot detection challenged the Playwright
sessions reliably even on slow human-paced runs; the same flow in real Chrome
on the same device, IP, and account was clean. Playwright fingerprint was the
variable. Running the same DOM clicks from inside real Chrome via an extension
sidesteps the entire detection problem.

## Install (development, unpacked)

1. `chrome://extensions/`
2. Enable Developer mode.
3. Load unpacked, pick this directory.
4. Right-click the extension icon -> Options. Paste your Todoist token and save.

## Running

1. Visit `walmart.com` in any tab. (Sign in if you aren't already.)
2. Click the extension icon. The popup pulls your Todoist Groceries list and
   resolves each item: SKU map hit -> direct PDP, miss -> Walmart search.
3. Confirm. Optionally tick "Dry run" to resolve URLs without clicking add.
4. Click "Add all to Groceries". The extension drives your Walmart tab through
   each item. For search-fallback items it pauses and asks you to pick from
   the top 3 results, then offers to remember the mapping for next time.

## Storage layout

| key | scope | what |
|---|---|---|
| `todoist:token` | local | bearer token (per device) |
| `todoist:project_id` | local | cached after first lookup |
| `sku:<name>` | sync | per-item Walmart product URL (cross-device sync) |
| `gb:queue`, `gb:cursor`, `gb:status`, `gb:tab_id`, `gb:dry_run` | session | active run only |
| `gb:last_run` | local | last-run report for the popup |

Note: `chrome.storage.sync` caps at 100 KB total / 512 keys; the SKU map is
practically bounded to ~500 distinct grocery names. Plenty for a household.

## Files

```
manifest.json
popup/         # popup UI: confirm screen, picker, last-run report
options/       # one-time Todoist token entry
background/    # MV3 service worker; assumes it dies between events
content/       # walmart.js -- programmatically injected per page
lib/
  state.js       # storage wrappers
  todoist.js     # /api/v1 client + cursor pagination
  sku-match.js   # fuzzy lookup (Levenshtein + token-sort)
  walmart-dom.js # selectors + click flows; the file you patch when DOM drifts
```

## Patching when Walmart redesigns

All selectors live in `lib/walmart-dom.js`. Devtools on a real walmart.com
page in Chrome is the right tool -- no Playwright needed. Reload the unpacked
extension after edits.

## TODO

- Icons (`icons/icon-{16,48,128}.png`) -- placeholder defaults today.
- Idempotency check in `walmart-dom.alreadyInList` -- currently always false.
