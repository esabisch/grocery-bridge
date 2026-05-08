import * as state from "../lib/state.js";
import * as todoist from "../lib/todoist.js";
import { findBest } from "../lib/sku-match.js";

const root = document.getElementById("root");

async function render() {
  const token = await state.getToken();
  if (!token) return renderNoToken();

  const s = await state.getQueueState();
  if (s.status === state.STATUSES.RUNNING) return renderRunning(s);
  if (s.status === state.STATUSES.AWAITING_PICK) return renderPick(s);
  if (s.status === state.STATUSES.PAUSED_CHALLENGE) return renderChallenge();
  return renderIdle();
}

function renderNoToken() {
  root.innerHTML = `
    <p>No Todoist token configured.</p>
    <button class="primary" id="setup">Set up</button>
  `;
  document.getElementById("setup").onclick = () => chrome.runtime.openOptionsPage();
}

async function renderIdle() {
  const last = await state.getLastRun();
  root.innerHTML = `
    <button class="primary" id="resolve">Resolve Todoist list</button>
    <div id="last"></div>
  `;
  document.getElementById("resolve").onclick = handleResolve;
  if (last) renderLastRun(last);
}

function renderLastRun(last) {
  const div = document.getElementById("last");
  if (!div) return;
  const when = new Date(last.finishedAt).toLocaleString();
  const rows = last.items
    .map((it) => {
      const r = it.result || { status: "unknown" };
      const cls =
        r.status === "added" || r.status === "dry_run"
          ? "ok"
          : r.status === "already_in_list"
            ? "warn"
            : "err";
      const title = it.picked_title ? ` (${esc(it.picked_title)})` : "";
      const reason = r.reason ? ` &mdash; ${esc(r.reason)}` : "";
      return `<li class="row">
          <span><b>${esc(it.name)}</b>${title}</span>
          <span class="tag ${cls}">${esc(r.status)}${reason}</span>
        </li>`;
    })
    .join("");
  div.innerHTML = `
    <section class="last-run-summary">
      <h2>Last run &mdash; ${esc(when)} (${esc(last.reason || "")}${last.dryRun ? ", dry" : ""})</h2>
      <ul>${rows}</ul>
    </section>
  `;
}

async function handleResolve() {
  root.innerHTML = `<p class="muted">Loading Todoist list...</p>`;
  try {
    const token = await state.getToken();
    let projectId = await state.getCachedProjectId();
    if (!projectId) {
      projectId = await todoist.findProjectId(token, "Groceries");
      await state.setCachedProjectId(projectId);
    }
    const items = await todoist.getActiveItems(token, projectId);
    if (items.length === 0) {
      root.innerHTML = `<p>No active items in Todoist Groceries. Done.</p>
        <button id="back">Back</button>`;
      document.getElementById("back").onclick = render;
      return;
    }

    const skus = await state.getAllSkus();
    const skuKeys = Object.keys(skus);
    const queue = items.map((it) => {
      const lc = it.content.trim().toLowerCase();
      let target_url, resolution;
      if (skus[lc]) {
        target_url = skus[lc];
        resolution = "sku_exact";
      } else {
        const best = findBest(lc, skuKeys, 88);
        if (best) {
          target_url = skus[best.key];
          resolution = `sku_fuzzy(${best.score})`;
        } else {
          target_url = `https://www.walmart.com/search?q=${encodeURIComponent(it.content)}`;
          resolution = "search";
        }
      }
      return { todoist_id: it.id, name: it.content, target_url, resolution };
    });
    renderConfirm(queue);
  } catch (e) {
    root.innerHTML = `<p class="err">Error: ${esc(e?.message || String(e))}</p>
      <button id="back">Back</button>`;
    document.getElementById("back").onclick = render;
  }
}

function renderConfirm(queue) {
  const rows = queue
    .map(
      (q) => `<li class="row">
        <span><b>${esc(q.name)}</b></span>
        <span class="tag ${q.resolution.startsWith("sku") ? "ok" : "warn"}">${esc(q.resolution)}</span>
      </li>`
    )
    .join("");
  root.innerHTML = `
    <h2>${queue.length} item${queue.length === 1 ? "" : "s"} to process</h2>
    <ul>${rows}</ul>
    <div class="toolbar">
      <label class="dry"><input type="checkbox" id="dry" /> Dry run</label>
      <button class="primary" id="go">Add all to Groceries</button>
      <button id="cancel">Cancel</button>
    </div>
  `;
  document.getElementById("go").onclick = async () => {
    const dryRun = document.getElementById("dry").checked;
    await chrome.runtime.sendMessage({ type: "start_queue", queue, dryRun });
    render();
  };
  document.getElementById("cancel").onclick = render;
}

async function renderRunning(s) {
  const cur = s.queue[s.cursor] || {};
  root.innerHTML = `
    <p>Running ${s.cursor + 1} / ${s.queue.length}: <b>${esc(cur.name || "")}</b></p>
    <p class="muted">${esc(cur.resolution || "")}</p>
    <button id="abort">Abort</button>
  `;
  document.getElementById("abort").onclick = async () => {
    await chrome.runtime.sendMessage({ type: "abort" });
  };
}

async function renderPick(s) {
  const out = await chrome.storage.session.get(state.SESS_KEYS.PICK_CANDIDATES);
  const cands = out[state.SESS_KEYS.PICK_CANDIDATES] || [];
  const item = s.queue[s.cursor];
  root.innerHTML = `
    <p>Pick a Walmart result for <b>${esc(item?.name || "")}</b>:</p>
    <div id="cands"></div>
    <button id="abort">Abort</button>
  `;
  const wrap = document.getElementById("cands");
  cands.forEach((c, i) => {
    const btn = document.createElement("button");
    btn.className = "cand";
    btn.dataset.i = String(i);
    btn.innerHTML = `
      ${c.thumbnail ? `<img src="${esc(c.thumbnail)}" alt="" />` : `<span></span>`}
      <span>
        <span class="title">${esc(c.title || "")}</span><br>
        <span class="price">${esc(c.price || "")}</span>
      </span>
    `;
    btn.addEventListener("click", () => onPick(item, c));
    wrap.appendChild(btn);
  });
  document.getElementById("abort").onclick = async () => {
    await chrome.runtime.sendMessage({ type: "abort" });
  };
}

async function onPick(item, candidate) {
  await chrome.runtime.sendMessage({
    type: "pick_chosen",
    url: candidate.url,
    title: candidate.title,
  });
  // Always-on SKU promotion prompt for v1.
  // confirm() works fine in extension popups.
  const remember = window.confirm(
    `Remember "${item?.name}" -> "${candidate.title}"?`
  );
  if (remember) {
    await chrome.runtime.sendMessage({
      type: "promote_sku",
      name: item.name,
      url: candidate.url,
    });
  }
  render();
}

function renderChallenge() {
  root.innerHTML = `
    <p>Walmart wants verification. Solve it in the tab; the queue will resume on its own.</p>
    <button id="abort">Abort</button>
  `;
  document.getElementById("abort").onclick = async () => {
    await chrome.runtime.sendMessage({ type: "abort" });
  };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// Re-render on storage changes so the popup always reflects current state.
chrome.storage.onChanged.addListener(() => render());

render();
