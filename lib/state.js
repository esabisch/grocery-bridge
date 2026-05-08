// Typed wrappers over chrome.storage.{session,sync,local} with namespaced keys.
// Used by popup, options, and the SW. Content script does NOT import this --
// it is loaded as a plain file via chrome.scripting.executeScript.

export const SESS_KEYS = {
  QUEUE: "gb:queue",
  CURSOR: "gb:cursor",
  STATUS: "gb:status",
  TAB_ID: "gb:tab_id",
  DRY_RUN: "gb:dry_run",
  PICK_CANDIDATES: "gb:pick_candidates",
};

export const STATUSES = {
  IDLE: "idle",
  RUNNING: "running",
  AWAITING_PICK: "awaiting_pick",
  PAUSED_CHALLENGE: "paused_challenge",
  DONE: "done",
  ABORTED: "aborted",
};

const LOCAL_KEYS = {
  TOKEN: "todoist:token",
  PROJECT_ID: "todoist:project_id",
  LAST_RUN: "gb:last_run",
};

const SKU_PREFIX = "sku:";

export async function getQueueState() {
  const raw = await chrome.storage.session.get([
    SESS_KEYS.QUEUE,
    SESS_KEYS.CURSOR,
    SESS_KEYS.STATUS,
    SESS_KEYS.TAB_ID,
    SESS_KEYS.DRY_RUN,
  ]);
  return {
    queue: raw[SESS_KEYS.QUEUE] || [],
    cursor: raw[SESS_KEYS.CURSOR] ?? 0,
    status: raw[SESS_KEYS.STATUS] || STATUSES.IDLE,
    tabId: raw[SESS_KEYS.TAB_ID] || null,
    dryRun: !!raw[SESS_KEYS.DRY_RUN],
  };
}

export async function setSession(obj) {
  return chrome.storage.session.set(obj);
}

export async function getSession(keys) {
  return chrome.storage.session.get(keys);
}

export async function clearSession() {
  return chrome.storage.session.remove([
    SESS_KEYS.QUEUE,
    SESS_KEYS.CURSOR,
    SESS_KEYS.STATUS,
    SESS_KEYS.TAB_ID,
    SESS_KEYS.DRY_RUN,
    SESS_KEYS.PICK_CANDIDATES,
  ]);
}

export async function getToken() {
  const out = await chrome.storage.local.get(LOCAL_KEYS.TOKEN);
  return out[LOCAL_KEYS.TOKEN] || null;
}

export async function setToken(token) {
  return chrome.storage.local.set({ [LOCAL_KEYS.TOKEN]: token });
}

export async function getCachedProjectId() {
  const out = await chrome.storage.local.get(LOCAL_KEYS.PROJECT_ID);
  return out[LOCAL_KEYS.PROJECT_ID] || null;
}

export async function setCachedProjectId(id) {
  return chrome.storage.local.set({ [LOCAL_KEYS.PROJECT_ID]: id });
}

export async function lookupSku(name) {
  const key = SKU_PREFIX + name.trim().toLowerCase();
  const out = await chrome.storage.sync.get(key);
  return out[key] || null;
}

export async function getAllSkus() {
  const all = await chrome.storage.sync.get(null);
  const result = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(SKU_PREFIX)) result[k.slice(SKU_PREFIX.length)] = v;
  }
  return result;
}

export async function setSku(name, url) {
  const key = SKU_PREFIX + name.trim().toLowerCase();
  return chrome.storage.sync.set({ [key]: url });
}

export async function getLastRun() {
  const out = await chrome.storage.local.get(LOCAL_KEYS.LAST_RUN);
  return out[LOCAL_KEYS.LAST_RUN] || null;
}

export async function setLastRun(report) {
  return chrome.storage.local.set({ [LOCAL_KEYS.LAST_RUN]: report });
}
