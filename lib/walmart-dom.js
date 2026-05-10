// Loaded into the content-script isolated world via chrome.scripting.executeScript.
// Plain script (no ES modules). Exposes globalThis.GB_DOM.
//
// All Walmart selectors live here. When (not if) Walmart redesigns, this is
// the single file to patch. Use the in-Chrome devtools on a real walmart.com
// page to find new selectors -- no Playwright required.

(() => {
  const LIST_NAME_DEFAULT = "Groceries";
  const GB_DOM_VERSION = "0.1.7-clean";
  console.debug(`[gb] walmart-dom loaded ${GB_DOM_VERSION}`);

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

  function extractPrice(tile) {
    // Walmart renders price as visible $4 + superscript 48, plus a hidden
    // screen-reader "current price $4.48" string. innerText can collapse the
    // visible piece into "$448" -- always go through structured/aria sources
    // first, then regex with a mandatory decimal as a last resort.
    if (!tile) return "";
    const itempropEl = tile.querySelector("[itemprop='price']");
    if (itempropEl) {
      const v = itempropEl.getAttribute("content");
      if (v && /^\d+(\.\d+)?$/.test(v)) return `$${parseFloat(v).toFixed(2)}`;
    }
    const ariaPriceEl = tile.querySelector(
      '[aria-label*="current price" i], [aria-label*="now $" i], [aria-label*="$" i]'
    );
    if (ariaPriceEl) {
      const m = (ariaPriceEl.getAttribute("aria-label") || "").match(
        /\$\d+(?:,\d{3})*(?:\.\d{2})/
      );
      if (m) return m[0];
    }
    const srEl = tile.querySelector(
      '.w_DA, [class*="visually-hidden" i], [class*="sr-only" i]'
    );
    if (srEl) {
      const m = (srEl.innerText || "").match(/\$\d+(?:,\d{3})*(?:\.\d{2})/);
      if (m) return m[0];
    }
    const txt = tile.innerText || "";
    const m = txt.match(/\$\d+(?:,\d{3})*(?:\.\d{2})/);
    return m ? m[0] : "";
  }

  function isSponsoredTile(rawHref, tile) {
    // Sponsored results route through Walmart's click tracker. Strongest signal.
    if (rawHref && rawHref.includes("/sp/track")) return true;
    // An explicit "Sponsored" badge inside the tile.
    if (tile?.querySelector?.('[aria-label*="Sponsored" i]')) return true;
    const head = (tile?.innerText || "").slice(0, 240);
    if (/\bSponsored\b/.test(head)) return true;
    return false;
  }

  function getSearchResults(n = 3) {
    const seen = new Set();
    const out = [];
    const links = document.querySelectorAll("a[href*='/ip/']");
    let total = 0;
    let skippedSponsored = 0;
    let dedupSkipped = 0;
    for (const a of links) {
      const rawHref = a.getAttribute("href") || "";
      const cleaned = cleanProductUrl(rawHref);
      const id = extractItemId(cleaned);
      if (!id) continue;
      total++;
      if (seen.has(id)) {
        dedupSkipped++;
        continue;
      }
      seen.add(id);
      const tile =
        a.closest("[data-item-id]") ||
        a.closest("div[role='group']") ||
        a.parentElement ||
        a;
      if (isSponsoredTile(rawHref, tile)) {
        skippedSponsored++;
        continue;
      }
      const titleEl =
        tile.querySelector('[data-automation-id="product-title"]') ||
        tile.querySelector("[link-identifier]") ||
        a;
      const title = (titleEl.innerText || a.innerText || "").trim().slice(0, 200);
      const price = extractPrice(tile);
      const img = tile.querySelector("img");
      out.push({
        url: cleaned,
        title,
        price,
        thumbnail: img?.src || null,
      });
      if (out.length >= n) break;
    }
    console.debug(
      `[gb] search results: ${out.length} kept / ${total} total /ip/ links ` +
        `(skipped ${skippedSponsored} sponsored, ${dedupSkipped} dup) on ${location.href}`
    );
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

  function isVisible(el) {
    if (!el || !el.offsetWidth || !el.offsetHeight) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }

  function findListPickerDialog() {
    // Walmart pre-renders many dialogs hidden in the DOM (Tachyons "dn" class
    // = display:none). Visibility filter is mandatory -- without it we match
    // the always-present fulfillment selector instead of the live picker.
    const all = Array.from(
      document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [role="menu"], [data-testid*="modal" i], [data-testid*="popover" i]'
      )
    );
    const visible = all.filter(isVisible);
    for (const d of visible) {
      const head = (d.innerText || "").slice(0, 400).toLowerCase();
      if (
        /add to list|save to list|select a list|your lists|create a list|new list/.test(head)
      ) {
        return d;
      }
    }
    return visible[0] || null;
  }

  function findListEntry(dlg, listName) {
    const re = new RegExp(`^\\s*${escapeRegex(listName)}\\s*$`, "i");
    const all = Array.from(dlg.querySelectorAll("*"));
    const textMatches = all.filter((el) => {
      const t = (el.innerText || "").trim().split("\n")[0].trim();
      return re.test(t);
    });
    for (const m of textMatches) {
      const row =
        m.closest('li, [role="listitem"], [role="row"]') ||
        m.closest('[role="option"], [role="checkbox"], [role="menuitemcheckbox"]') ||
        m.parentElement;
      if (!row || !dlg.contains(row)) continue;

      // Drill: native checkbox > role=checkbox/option/menuitem > button > label > row.
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) return cb;
      const aria = row.querySelector(
        '[role="checkbox"], [role="menuitemcheckbox"], [role="option"]'
      );
      if (aria) return aria;
      const btn = row.querySelector('button, [role="button"]');
      if (btn) return btn;
      const lbl = row.querySelector("label");
      if (lbl) return lbl;
      return row;
    }
    return null;
  }

  function dumpDialogForDebug(dlg) {
    const entries = Array.from(
      dlg.querySelectorAll(
        'button, [role="option"], [role="checkbox"], [role="menuitemcheckbox"], label, li'
      )
    )
      .map((el) => ({
        tag: el.tagName,
        role: el.getAttribute("role") || "",
        text: (el.innerText || "").trim().slice(0, 160).replace(/\n/g, " | "),
        firstLine: (el.innerText || "").trim().split("\n")[0].trim().slice(0, 80),
      }))
      .filter((x) => x.text);
    console.warn("[gb] addToList: list entry not found; dialog candidates below");
    console.table(entries);
    console.log("[gb] addToList: dialog outerHTML (truncated)");
    console.log((dlg.outerHTML || "").slice(0, 4000));
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
    console.debug("[gb] addToList: clicking 'Add to list'", {
      tag: btn.tagName,
      text: (btn.innerText || "").trim().slice(0, 60),
      aria: (btn.getAttribute("aria-label") || "").slice(0, 80),
    });
    btn.click();
    await sleep(1500);

    // 3. Locate the list-picker dialog (visible only).
    const dlg = findListPickerDialog();
    if (!dlg) return { ok: false, reason: "no_picker_dialog" };
    console.debug("[gb] addToList: dialog found", {
      ariaLabel: dlg.getAttribute("aria-label") || "",
      role: dlg.getAttribute("role") || "",
      headText: (dlg.innerText || "").slice(0, 200),
    });

    // 4. Find the entry whose text matches our list name; walk to a clickable ancestor.
    const entry = findListEntry(dlg, listName);
    if (!entry) {
      dumpDialogForDebug(dlg);
      return { ok: false, reason: "list_not_in_picker" };
    }
    console.debug("[gb] addToList: clicking entry for", listName, {
      tag: entry.tagName,
      role: entry.getAttribute("role") || "",
      text: (entry.innerText || "").trim().slice(0, 120),
      hasCheckbox: !!entry.querySelector?.('input[type="checkbox"]'),
    });
    // If the entry contains an unchecked checkbox, click that directly --
    // some implementations don't toggle from the wrapping label/button click.
    const cb = entry.querySelector?.('input[type="checkbox"]');
    if (cb && !cb.checked) {
      cb.click();
    } else {
      entry.click();
    }
    await sleep(900);

    // 5. Look for a Done/Save button -- search both the dialog AND the whole
    //    document, since Walmart sometimes places the commit button outside
    //    the [role=dialog] container.
    const done =
      buttonByText("Done", dlg) ||
      buttonByText("Save", dlg) ||
      buttonByText("Add to list", dlg) ||
      buttonByText("Done") ||
      buttonByText("Save");
    console.debug(
      "[gb] addToList: post-click commit button",
      done
        ? { tag: done.tagName, text: (done.innerText || "").trim().slice(0, 40) }
        : "none-found"
    );
    if (done) {
      done.click();
      await sleep(800);
    }

    // 6. Verify: look for a confirmation toast/alert that the item was saved.
    const toastEl = document.querySelector(
      '[role="alert"], [role="status"], [aria-live]:not([aria-live="off"])'
    );
    const toastText = toastEl ? (toastEl.innerText || "").slice(0, 200).trim() : "";
    console.debug("[gb] addToList: confirmation surface", {
      found: !!toastEl,
      text: toastText,
    });
    const confirmed = /saved|added|success/i.test(toastText);

    return { ok: true, confirmed, toast: toastText };
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
