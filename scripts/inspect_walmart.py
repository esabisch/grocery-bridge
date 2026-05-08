"""Interactive Walmart DOM inspection.

One long-lived chromium session, paced like a human, prompting at each step so
you can watch live and bail if Walmart serves a bot challenge. We're capturing
ground-truth selectors for the search-result tile, the PDP add-to-list flow,
and the list-picker dialog -- but doing zero actual mutations.

Run from repo root:
    python -m scripts.inspect_walmart
"""

import asyncio
import json
import sys

sys.path.insert(0, ".")

from src.walmart import walmart_session, WALMART_HOME  # noqa: E402


async def _wait_enter(prompt: str) -> None:
    print(f"\n>> {prompt}")
    await asyncio.get_event_loop().run_in_executor(None, input)


async def _check_for_challenge(page) -> bool:
    """Return True if Walmart served a Press-and-Hold / robot-check page."""
    try:
        text = await page.evaluate("() => (document.body.innerText || '').slice(0, 2000)")
    except Exception:
        return False
    flagged = any(
        s in text.lower()
        for s in ("press and hold", "press & hold", "are you a robot", "verify you are human", "access denied")
    )
    if flagged:
        print("\n!! BOT CHALLENGE DETECTED on page.")
        print("   Solve it manually in the browser window, then come back here.")
        await _wait_enter("Press Enter once you've cleared the challenge.")
    return flagged


async def _slow_scroll(page, steps: int = 4, dy: int = 250, dt: float = 0.6) -> None:
    """Scroll down in chunks to look human."""
    for _ in range(steps):
        await page.mouse.wheel(0, dy)
        await asyncio.sleep(dt)


async def main() -> None:
    print("Walmart DOM inspector. One window, slow pace, you drive.\n")
    async with walmart_session(headless=False) as ctx:
        page = await ctx.new_page()

        # 1. Homepage warmup
        print("Step 1: navigate to homepage (warmup)")
        await page.goto(WALMART_HOME, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(5)
        await _slow_scroll(page, steps=3)
        await _check_for_challenge(page)
        print(f"   url:   {page.url}")
        print(f"   title: {await page.title()}")
        await _wait_enter("Homepage looks ok? Press Enter to search 'milk'.")

        # 2. Search results
        print("\nStep 2: search for 'milk'")
        await page.goto(f"{WALMART_HOME}/search?q=milk", wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(6)
        await _slow_scroll(page, steps=3)
        await _check_for_challenge(page)
        results = await page.evaluate("""
        () => Array.from(document.querySelectorAll("a[href*='/ip/']"))
            .slice(0,5)
            .map(a => ({text: (a.innerText||'').trim().slice(0,90), href: a.getAttribute('href')}))
        """)
        print(f"   first {len(results)} results:")
        for r in results:
            print(f"     - {r['text'][:70]} ({r['href'][:80]}...)")
        if not results:
            print("!! no /ip/ links found -- Walmart may have shadow-rendered the page")
            return
        await _wait_enter("Press Enter to click into the first product result.")

        # 3. PDP -- click (don't goto) the first result
        print("\nStep 3: click first result and inspect PDP")
        first_link = page.locator("a[href*='/ip/']").first
        # Hover before click to look human
        await first_link.hover()
        await asyncio.sleep(1.2)
        await first_link.click()
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=20000)
        except Exception:
            pass
        await asyncio.sleep(6)
        await _slow_scroll(page, steps=4)
        await _check_for_challenge(page)
        print(f"   url:   {page.url}")
        print(f"   title: {await page.title()}")
        pdp = await page.evaluate("""
        () => {
          const out = {};
          // All buttons whose text or aria mentions list/save/favorite
          out.list_buttons = Array.from(document.querySelectorAll('button,a[role="button"]'))
            .map(b => ({
              tag: b.tagName,
              text: (b.innerText||'').trim().slice(0,80),
              aria: (b.getAttribute('aria-label')||'').slice(0,100),
              testid: b.getAttribute('data-testid') || '',
              haspopup: b.getAttribute('aria-haspopup') || '',
              expanded: b.getAttribute('aria-expanded') || '',
              visible: b.offsetWidth > 0 && b.offsetHeight > 0,
            }))
            .filter(x => /list|save|favorite|registry/i.test(x.text + ' ' + x.aria + ' ' + x.testid));
          // Heart icon details
          const heart = document.querySelector('[aria-label*="Add to Favorites list" i], [aria-label*="Add to favorites" i]');
          if (heart) {
            out.heart = {
              tag: heart.tagName,
              aria: heart.getAttribute('aria-label'),
              haspopup: heart.getAttribute('aria-haspopup'),
              expanded: heart.getAttribute('aria-expanded'),
            };
            // Look at heart's nearby siblings for a dropdown trigger
            const parent = heart.parentElement;
            if (parent) {
              out.heart_siblings = Array.from(parent.children).map(c => ({
                tag: c.tagName,
                aria: c.getAttribute('aria-label') || '',
                haspopup: c.getAttribute('aria-haspopup') || '',
                expanded: c.getAttribute('aria-expanded') || '',
                text: (c.innerText||'').trim().slice(0,40),
              }));
            }
          }
          return out;
        }
        """)
        print("   list-related buttons on page:")
        print(json.dumps(pdp, indent=2))
        await _wait_enter("Press Enter to attempt opening the list picker.")

        # 4. Try to open the list picker. Strategy:
        #    a) If a button literally says "Add to list" and is visible, click it.
        #    b) Else, click the heart's adjacent dropdown trigger (aria-haspopup near it).
        print("\nStep 4: open list picker")
        clicked = None
        for sel, label in [
            ('button:has-text("Add to list"):visible', "Add to list (visible)"),
            ('button[aria-label*="Add to list" i]:visible', "Add to list (aria, visible)"),
        ]:
            loc = page.locator(sel).first
            if await loc.count() > 0:
                try:
                    await loc.scroll_into_view_if_needed(timeout=2000)
                    await asyncio.sleep(0.6)
                    await loc.click(timeout=4000)
                    clicked = label
                    break
                except Exception as e:
                    print(f"   tried '{label}': {type(e).__name__} {e}")

        # If neither direct button worked, look for a popup trigger near the heart
        if not clicked:
            popup = page.locator('button[aria-haspopup="menu"], button[aria-haspopup="true"]').first
            if await popup.count() > 0:
                try:
                    await popup.scroll_into_view_if_needed(timeout=2000)
                    await asyncio.sleep(0.6)
                    await popup.click(timeout=4000)
                    clicked = "aria-haspopup trigger"
                    await asyncio.sleep(1)
                    # Then click "Add to list" in the now-visible menu
                    in_menu = page.locator('[role="menuitem"]:has-text("Add to list"), button:has-text("Add to list")').first
                    if await in_menu.count() > 0:
                        await in_menu.click(timeout=4000)
                        clicked += " -> Add to list"
                except Exception as e:
                    print(f"   popup attempt: {type(e).__name__} {e}")

        if not clicked:
            print("!! could not find any list trigger -- dumping all aria-haspopup elements for analysis")
            popups = await page.evaluate("""
              () => Array.from(document.querySelectorAll('[aria-haspopup]'))
                .map(el => ({tag: el.tagName, aria: el.getAttribute('aria-label')||'', text: (el.innerText||'').trim().slice(0,60)}))
            """)
            print(json.dumps(popups, indent=2))
            return
        print(f"   clicked: {clicked}")
        await asyncio.sleep(3)
        await _check_for_challenge(page)

        # 5. Capture list picker dialog
        print("\nStep 5: capture list picker dialog DOM")
        picker = await page.evaluate("""
        () => {
          const dlg = document.querySelector('[role="dialog"], [aria-modal="true"]');
          if (!dlg) return {dialog_present: false};
          return {
            dialog_present: true,
            text: (dlg.innerText || '').slice(0, 1000),
            entries: Array.from(dlg.querySelectorAll('button,[role="option"],li,a'))
              .map(el => ({
                tag: el.tagName,
                role: el.getAttribute('role') || '',
                text: (el.innerText||'').trim().slice(0,80),
                testid: el.getAttribute('data-testid') || '',
              }))
              .filter(x => x.text)
              .slice(0, 30),
          };
        }
        """)
        print(json.dumps(picker, indent=2))

        await _wait_enter("Inspection done. Press Enter to close the browser.")

if __name__ == "__main__":
    asyncio.run(main())
