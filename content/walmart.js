// Loaded after lib/walmart-dom.js by chrome.scripting.executeScript.
// Listens for SW messages and reports outcomes. No durable state lives here.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg && msg.action === "process_current") {
        sendResponse(await processCurrent(msg));
      } else if (msg && msg.action === "detect") {
        sendResponse({ ok: true, challenged: GB_DOM.detectChallenge() });
      } else {
        sendResponse({ ok: false, status: "unknown_action" });
      }
    } catch (e) {
      sendResponse({
        ok: false,
        status: "error",
        reason: String((e && e.message) || e),
      });
    }
  })();
  return true;
});

async function processCurrent(msg) {
  if (GB_DOM.detectChallenge()) {
    return { ok: false, status: "challenged" };
  }

  // Give the SPA a moment to hydrate before we poke at it. Walmart search
  // pages especially are slow to render organic tiles after the sponsored
  // ones; under-waiting causes a "no results" false negative.
  await sleep(2500);

  if (location.pathname.startsWith("/search")) {
    const candidates = GB_DOM.getSearchResults(3);
    if (candidates.length === 0) {
      return { ok: false, status: "no_results" };
    }
    return { ok: true, status: "need_pick", candidates };
  }

  if (location.pathname.startsWith("/ip/")) {
    if (await GB_DOM.alreadyInList(msg.listName || "Groceries")) {
      return { ok: true, status: "already_in_list", url: location.href };
    }
    if (msg.dryRun) {
      return { ok: true, status: "dry_run", url: location.href };
    }
    const r = await GB_DOM.addToList(msg.listName || "Groceries");
    return r.ok
      ? { ok: true, status: "added", url: location.href }
      : { ok: false, status: "failed", reason: r.reason, url: location.href };
  }

  return { ok: false, status: "unknown_page", url: location.href };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
