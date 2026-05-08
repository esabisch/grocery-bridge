// MV3 service worker. Assume the SW is terminated between events; never store
// queue position, item state, or anything else in module-scope variables. All
// listeners are registered at module top level so they re-attach on every SW
// wake. All durable state lives in chrome.storage.session/local.
//
// Primary challenge-resume trigger is chrome.tabs.onUpdated; chrome.alarms
// is only a fallback in case the post-challenge redirect doesn't fire a
// status:"complete" event.

import * as state from "../lib/state.js";
import * as todoist from "../lib/todoist.js";

const ICON_URL = "icons/icon-128.png";
const LIST_NAME = "Groceries";

// ----------------------------------------------------------------------------
// Top-level listeners
// ----------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const result = await routeMessage(msg);
      sendResponse({ ok: true, ...(result || {}) });
    } catch (e) {
      console.error("[gb] sw error", e);
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  const s = await state.getQueueState();
  if (!s.tabId || s.tabId !== tabId) return;

  // Tab navigated away from walmart.com -- abort per directive.
  if (tab.url && !tab.url.includes("walmart.com")) {
    await abortRun({ reason: `tab navigated away (${new URL(tab.url).hostname})` });
    return;
  }

  if (change.status !== "complete") return;

  if (s.status === state.STATUSES.PAUSED_CHALLENGE) {
    await tryResumeAfterChallenge(s, tabId);
    return;
  }

  if (s.status === state.STATUSES.RUNNING) {
    await processLoadedPage(s, tabId);
    return;
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "gb-challenge-recheck") return;
  const s = await state.getQueueState();
  if (s.status !== state.STATUSES.PAUSED_CHALLENGE) {
    await chrome.alarms.clear("gb-challenge-recheck").catch(() => {});
    return;
  }
  if (!s.tabId) return;
  await tryResumeAfterChallenge(s, s.tabId);
});

// ----------------------------------------------------------------------------
// Message router
// ----------------------------------------------------------------------------

async function routeMessage(msg) {
  if (!msg || !msg.type) return {};
  switch (msg.type) {
    case "start_queue":
      return startQueue(msg);
    case "abort":
      await abortRun({ reason: "user aborted" });
      return {};
    case "pick_chosen":
      return pickChosen(msg);
    case "promote_sku":
      await state.setSku(msg.name, msg.url);
      return { promoted: true };
    case "get_status":
      return state.getQueueState();
    default:
      return {};
  }
}

// ----------------------------------------------------------------------------
// Queue lifecycle
// ----------------------------------------------------------------------------

async function startQueue(msg) {
  if (!Array.isArray(msg.queue) || msg.queue.length === 0) {
    return { started: false, reason: "empty_queue" };
  }

  // Find a walmart.com tab to take over, or open one.
  const tabs = await chrome.tabs.query({ url: "https://www.walmart.com/*" });
  let tabId = tabs[0]?.id;
  if (!tabId) {
    const t = await chrome.tabs.create({ url: "https://www.walmart.com/" });
    tabId = t.id;
  } else {
    await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  }

  await state.setSession({
    [state.SESS_KEYS.QUEUE]: msg.queue,
    [state.SESS_KEYS.CURSOR]: 0,
    [state.SESS_KEYS.STATUS]: state.STATUSES.RUNNING,
    [state.SESS_KEYS.TAB_ID]: tabId,
    [state.SESS_KEYS.DRY_RUN]: !!msg.dryRun,
  });

  await chrome.tabs.update(tabId, { url: msg.queue[0].target_url });
  return { started: true, tabId };
}

async function processLoadedPage(s, tabId) {
  // Inject the DOM helpers + content script into the now-loaded page.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["lib/walmart-dom.js", "content/walmart.js"],
    });
  } catch (e) {
    await markCurrentResult(s, { status: "failed", reason: `inject_failed: ${e.message}` });
    return advance(s, tabId);
  }

  // Small settle to let onMessage listener register.
  await sleep(300);

  const r = await chrome.tabs
    .sendMessage(tabId, {
      action: "process_current",
      dryRun: s.dryRun,
      listName: LIST_NAME,
    })
    .catch((e) => ({ ok: false, status: "error", reason: e?.message }));

  await handleProcessResult(r, tabId);
}

async function handleProcessResult(r, tabId) {
  const s = await state.getQueueState();

  if (!r) {
    await markCurrentResult(s, { status: "failed", reason: "no_response" });
    return advance(s, tabId);
  }

  if (r.status === "challenged") {
    await state.setSession({ [state.SESS_KEYS.STATUS]: state.STATUSES.PAUSED_CHALLENGE });
    await notify("gb-challenge", {
      title: "Grocery Bridge paused",
      message: "Walmart wants verification. Solve in the tab; queue resumes automatically.",
    });
    // Fallback poll, in case onUpdated doesn't fire after the challenge clears.
    await chrome.alarms.create("gb-challenge-recheck", { periodInMinutes: 0.5 });
    return;
  }

  if (r.status === "need_pick") {
    await state.setSession({
      [state.SESS_KEYS.STATUS]: state.STATUSES.AWAITING_PICK,
      [state.SESS_KEYS.PICK_CANDIDATES]: r.candidates,
    });
    const item = s.queue[s.cursor];
    await notify(`gb-pick-${s.cursor}`, {
      title: "Grocery Bridge needs a pick",
      message: `Pick a Walmart result for "${item?.name || "(unknown)"}"`,
    });
    return;
  }

  if (
    r.status === "added" ||
    r.status === "already_in_list" ||
    r.status === "dry_run"
  ) {
    await markCurrentResult(s, { status: r.status, url: r.url });
    if (r.status === "added" && !s.dryRun) {
      const item = s.queue[s.cursor];
      try {
        const token = await state.getToken();
        if (token && item?.todoist_id) await todoist.closeTask(token, item.todoist_id);
      } catch (e) {
        console.warn("[gb] todoist close failed", e);
      }
    }
    return advance(s, tabId);
  }

  // Anything else is a failure; record reason and advance.
  await markCurrentResult(s, {
    status: "failed",
    reason: r.reason || r.status || "unknown",
  });
  return advance(s, tabId);
}

async function advance(s, tabId) {
  const next = s.cursor + 1;
  if (next >= s.queue.length) {
    return finishRun({ reason: "complete" });
  }
  await state.setSession({ [state.SESS_KEYS.CURSOR]: next });
  await chrome.tabs.update(tabId, { url: s.queue[next].target_url });
}

async function markCurrentResult(s, result) {
  const queue = s.queue.slice();
  if (queue[s.cursor]) {
    queue[s.cursor] = { ...queue[s.cursor], result };
  }
  await state.setSession({ [state.SESS_KEYS.QUEUE]: queue });
}

async function pickChosen(msg) {
  const s = await state.getQueueState();
  if (!s.tabId) return { ok: false, error: "no_tab" };
  const queue = s.queue.slice();
  if (queue[s.cursor]) {
    queue[s.cursor] = { ...queue[s.cursor], target_url: msg.url, picked_title: msg.title || null };
  }
  await state.setSession({
    [state.SESS_KEYS.QUEUE]: queue,
    [state.SESS_KEYS.STATUS]: state.STATUSES.RUNNING,
  });
  await chrome.storage.session.remove(state.SESS_KEYS.PICK_CANDIDATES);
  await chrome.tabs.update(s.tabId, { url: msg.url });
  return { ok: true };
}

async function tryResumeAfterChallenge(s, tabId) {
  // Inject helpers + ask whether the page is still showing a challenge.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["lib/walmart-dom.js", "content/walmart.js"],
    });
  } catch {
    return;
  }
  await sleep(300);
  const r = await chrome.tabs.sendMessage(tabId, { action: "detect" }).catch(() => null);
  if (!r || r.challenged) return;

  // Cleared! Resume by re-issuing the navigation to the current item.
  await chrome.alarms.clear("gb-challenge-recheck").catch(() => {});
  await state.setSession({ [state.SESS_KEYS.STATUS]: state.STATUSES.RUNNING });
  const cur = s.queue[s.cursor];
  if (cur?.target_url) await chrome.tabs.update(tabId, { url: cur.target_url });
}

async function finishRun({ reason }) {
  const s = await state.getQueueState();
  const items = s.queue.map((it) => ({
    name: it.name,
    target_url: it.target_url,
    picked_title: it.picked_title || null,
    resolution: it.resolution || null,
    result: it.result || null,
  }));
  await state.setLastRun({
    finishedAt: Date.now(),
    reason,
    dryRun: s.dryRun,
    items,
  });
  await state.clearSession();
  await chrome.alarms.clear("gb-challenge-recheck").catch(() => {});

  const added = items.filter((i) => i.result?.status === "added").length;
  const dry = items.filter((i) => i.result?.status === "dry_run").length;
  const failed = items.filter((i) => i.result?.status === "failed").length;
  const skipped = items.filter((i) => i.result?.status === "already_in_list").length;
  await notify("gb-done", {
    title: "Grocery Bridge finished",
    message:
      `${reason}. added: ${added}` +
      (dry ? `, dry: ${dry}` : "") +
      (skipped ? `, already-in: ${skipped}` : "") +
      (failed ? `, failed: ${failed}` : ""),
  });
}

async function abortRun({ reason }) {
  await finishRun({ reason: `aborted: ${reason}` });
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function notify(id, { title, message }) {
  try {
    await chrome.notifications.create(id, {
      type: "basic",
      iconUrl: ICON_URL,
      title,
      message,
      priority: 2,
    });
  } catch (e) {
    console.warn("[gb] notify failed", e);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
