// Loaded into the content-script isolated world via chrome.scripting.executeScript.
// Plain script (no ES modules). Exposes globalThis.GB_DOM.
//
// All Walmart selectors live here. When (not if) Walmart redesigns, this is
// the single file to patch. Use the in-Chrome devtools on a real walmart.com
// page to find new selectors -- no Playwright required.

(() => {
  const LIST_NAME_DEFAULT = "Groceries";

  function detectChallenge() {
    if (/\/blocked(\?|$)/.test(location.pathname)) return true;
    if (/robot or human|are you a robot/i.test(document.title || "")) return true;
    const txt = (document.body?.innerText || "").slice(0, 2000).toLowerCase();
    return /press\s*and\s*hold|press\s*&\s*hold|are you a robot|verify you are human|access denied/.test(
      txt
    );
  }

  function cleanProductUrl(href) {
    if (!href) return null;
    try {
      const u = new URL(href, location.origin);
      // Walmart sponsored-result tracker -> real /ip/ URL is in the &rd= param
      if (u.pathname.startsWith("/sp/track")) {
        const rd = u.searchParams.get("rd");
        if (rd) return decodeURIComponent(rd);
      }
      return u.toString();
    } catch {
      return href;
    }
  }

  function extractItemId(url) {
    const m = url && url.match(/\/ip\/[^?]+\/(\d+)/);
    return m ? m[1] : null;
  }

  function getSearchResults(n = 3) {
    const seen = new Set();
    const out = [];
    const links = document.querySelectorAll("a[href*='/ip/']");
    for (const a of links) {
      const cleaned = cleanProductUrl(a.getAttribute("href") || "");
      const id = extractItemId(cleaned);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const tile =
        a.closest("[data-item-id]") ||
        a.closest("div[role='group']") ||
        a.parentElement ||
        a;
      const titleEl =
        tile.querySelector('[data-automation-id="product-title"]') ||
        tile.querySelector("[link-identifier]") ||
        a;
      const title = (titleEl.innerText || a.innerText || "").trim().slice(0, 200);
      const priceEl =
        tile.querySelector('[data-automation-id*="price"]') ||
        tile.querySelector("[itemprop='price']");
      const price = priceEl ? priceEl.innerText.trim().slice(0, 60) : "";
      const img = tile.querySelector("img");
      out.push({
        url: cleaned,
        title,
        price,
        thumbnail: img?.src || null,
      });
      if (out.length >= n) break;
    }
    return out;
  }

  function buttonByText(text, scope = document) {
    const re = new RegExp(`^\\s*${escapeRegex(text)}\\s*$`, "i");
    return Array.from(scope.querySelectorAll("button")).find(
      (b) => b.offsetWidth > 0 && re.test((b.innerText || "").trim())
    );
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async function alreadyInList(_listName) {
    // Conservative for v1: no idempotency check yet. Walmart's "already in list"
    // affordance varies by surface; needs a follow-up patch once we observe it
    // on a live page. Returning false means we always attempt to add; Walmart
    // dedupes on its side (a list can't contain the same item twice).
    return false;
  }

  async function addToList(listName) {
    listName = listName || LIST_NAME_DEFAULT;

    // 1. Find a visible "Add to list" button on the buy box.
    let btn = buttonByText("Add to list");

    // 2. Fallback: open the heart-icon dropdown and look for it inside the menu.
    if (!btn) {
      const heart = document.querySelector(
        '[aria-label*="Add to Favorites list" i], [aria-label*="Add to favorites" i]'
      );
      if (heart) {
        const trigger =
          heart.parentElement?.querySelector("[aria-haspopup]") ||
          heart.parentElement?.parentElement?.querySelector("[aria-haspopup]");
        if (trigger) {
          trigger.click();
          await sleep(800);
          btn = buttonByText("Add to list");
        }
      }
    }

    if (!btn) return { ok: false, reason: "no_add_to_list_button" };
    btn.click();
    await sleep(1200);

    // 3. List picker dialog appears.
    const dlg = document.querySelector('[role="dialog"], [aria-modal="true"]');
    if (!dlg) return { ok: false, reason: "no_picker_dialog" };

    // 4. Click the entry whose first-line text matches our list name.
    const re = new RegExp(`^\\s*${escapeRegex(listName)}\\s*$`, "i");
    const entry = Array.from(
      dlg.querySelectorAll('button, [role="option"], li')
    ).find((el) => {
      const firstLine = (el.innerText || "").trim().split("\n")[0].trim();
      return re.test(firstLine);
    });
    if (!entry) return { ok: false, reason: "list_not_in_picker" };
    entry.click();
    await sleep(900);

    // 5. Some dialogs require an explicit Done/Save click to commit.
    const done = buttonByText("Done", dlg) || buttonByText("Save", dlg);
    if (done) {
      done.click();
      await sleep(500);
    }

    return { ok: true };
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  globalThis.GB_DOM = {
    detectChallenge,
    cleanProductUrl,
    extractItemId,
    getSearchResults,
    addToList,
    alreadyInList,
  };
})();
