"""Walmart automation via Playwright.

Strategy: persistent browser profile (keeps you logged in across runs), stealth
plugin to mask automation fingerprints, human-paced clicks. We target the
Walmart "Lists" feature rather than the cart directly -- lower detection
surface, and you keep human-in-the-loop for actual checkout.

Selectors will rot. When Walmart redesigns, run with `headless=False` and
update locators here.
"""

import asyncio
import logging
import random
from contextlib import asynccontextmanager
from typing import AsyncIterator

from playwright.async_api import (
    BrowserContext,
    Page,
    async_playwright,
)
from playwright_stealth import Stealth

from .config import settings

log = logging.getLogger(__name__)

WALMART_HOME = "https://www.walmart.com"
WALMART_LISTS_URL = f"{WALMART_HOME}/lists"
WALMART_LOGIN_URL = f"{WALMART_HOME}/account/login"


async def _human_pause(min_ms: int = 200, max_ms: int = 900) -> None:
    await asyncio.sleep(random.uniform(min_ms, max_ms) / 1000.0)


@asynccontextmanager
async def walmart_session(headless: bool = True) -> AsyncIterator[BrowserContext]:
    """Async context manager yielding a logged-in (hopefully) Walmart browser context."""
    profile_dir = settings.browser_profile_dir.resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)

    # Stealth().use_async() auto-applies evasions to every page created in this context.
    async with Stealth().use_async(async_playwright()) as pw:
        context = await pw.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=headless,
            viewport={"width": 1366, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/130.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            timezone_id="America/Chicago",
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                # Force window onto a visible spot (WSLg sometimes opens off-screen).
                "--window-position=100,100",
                "--window-size=1366,900",
            ],
        )
        try:
            yield context
        finally:
            await context.close()


async def is_logged_in(page: Page) -> bool:
    """Heuristic: visit /lists; if redirected to /account/login we're not in."""
    await page.goto(WALMART_LISTS_URL, wait_until="domcontentloaded")
    await _human_pause()
    return "/account/login" not in page.url


async def open_login_page(context: BrowserContext) -> Page:
    page = await context.new_page()
    await page.goto(WALMART_LOGIN_URL, wait_until="domcontentloaded")
    return page


async def add_product_url_to_list(page: Page, product_url: str, list_name: str) -> bool:
    """Navigate to a product page, open the 'Add to list' menu, select list_name."""
    log.info("Adding product to list: %s", product_url)
    await page.goto(product_url, wait_until="domcontentloaded")
    await _human_pause(800, 1500)

    # Walmart's "Add to list" button text varies; try several locators.
    candidates = [
        page.get_by_role("button", name="Add to list"),
        page.get_by_role("button", name="Save for later"),
        page.locator("button:has-text('Add to list')"),
    ]
    for loc in candidates:
        try:
            await loc.first.click(timeout=4000)
            break
        except Exception:
            continue
    else:
        log.warning("Could not find 'Add to list' button on %s", product_url)
        return False

    await _human_pause(400, 900)
    # The list picker appears as a dialog; click the named list.
    try:
        await page.get_by_role("button", name=list_name).click(timeout=4000)
    except Exception:
        try:
            await page.locator(f"text={list_name}").first.click(timeout=4000)
        except Exception:
            log.warning("Could not find list '%s' in picker", list_name)
            return False

    await _human_pause(500, 1200)
    return True


async def search_and_add_first(page: Page, query: str, list_name: str) -> bool:
    """Search Walmart for query, click the first result, add to list."""
    log.info("Searching Walmart for: %s", query)
    await page.goto(
        f"{WALMART_HOME}/search?q={query.replace(' ', '+')}",
        wait_until="domcontentloaded",
    )
    await _human_pause(800, 1600)

    # First product tile -- selector likely to drift.
    candidates = [
        page.locator("[data-item-id] a").first,
        page.locator("a[link-identifier]").first,
        page.locator("div[data-testid='list-view'] a").first,
    ]
    for loc in candidates:
        try:
            href = await loc.get_attribute("href", timeout=3000)
            if href and "/ip/" in href:
                product_url = href if href.startswith("http") else WALMART_HOME + href
                return await add_product_url_to_list(page, product_url, list_name)
        except Exception:
            continue
    log.warning("No search result found for '%s'", query)
    return False
