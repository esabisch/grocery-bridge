"""Orchestrator: pull from Todoist, push into a Walmart list.

Flow per item:
  1. SKU map hit  -> navigate directly to the product, click Add to list.
  2. SKU map miss -> Walmart search, take first result, add to list.
  3. On success    -> close the Todoist task so it disappears from the list.
"""

import logging
from dataclasses import dataclass

from . import sku_map, todoist
from .config import settings
from .walmart import (
    add_product_url_to_list,
    is_logged_in,
    search_and_add_first,
    walmart_session,
)

log = logging.getLogger(__name__)


@dataclass
class ItemResult:
    item: str
    todoist_id: str
    matched_via: str  # "sku_map" | "search" | "miss"
    added: bool
    walmart_url: str | None = None


@dataclass
class SyncResult:
    logged_in: bool
    items: list[ItemResult]

    @property
    def added_count(self) -> int:
        return sum(1 for i in self.items if i.added)


async def sync(*, headless: bool = True, close_completed: bool = True) -> SyncResult:
    items = await todoist.get_grocery_items()
    if not items:
        log.info("Todoist grocery list is empty -- nothing to do.")
        return SyncResult(logged_in=True, items=[])

    results: list[ItemResult] = []

    async with walmart_session(headless=headless) as ctx:
        page = await ctx.new_page()
        if not await is_logged_in(page):
            log.error("Walmart session is not logged in. Run scripts/walmart_login.py")
            return SyncResult(logged_in=False, items=[])

        for it in items:
            name = it["content"]
            mapped = sku_map.lookup(name)
            if mapped:
                ok = await add_product_url_to_list(page, mapped, settings.walmart_list_name)
                results.append(
                    ItemResult(
                        item=name,
                        todoist_id=it["id"],
                        matched_via="sku_map",
                        added=ok,
                        walmart_url=mapped,
                    )
                )
            else:
                ok = await search_and_add_first(page, name, settings.walmart_list_name)
                results.append(
                    ItemResult(
                        item=name,
                        todoist_id=it["id"],
                        matched_via="search" if ok else "miss",
                        added=ok,
                    )
                )

            if ok and close_completed:
                try:
                    await todoist.close_task(it["id"])
                except Exception as e:
                    log.warning("Failed to close Todoist task %s: %s", it["id"], e)

    return SyncResult(logged_in=True, items=results)
