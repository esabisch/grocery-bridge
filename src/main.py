"""FastAPI service.

Deployed behind Cloudflare Tunnel + Cloudflare Access. Identity comes from the
`Cf-Access-Authenticated-User-Email` header injected by Cloudflare at the edge.
Local dev falls back to settings.dev_user_email.
"""

import logging

from fastapi import FastAPI, Header, HTTPException

from . import sku_map
from .config import settings
from .sync import sync

logging.basicConfig(level=settings.log_level)
log = logging.getLogger(__name__)

app = FastAPI(title="grocery-bridge", version="0.1.0")


def _identity(cf_email: str | None) -> str:
    email = cf_email or settings.dev_user_email
    if not email:
        raise HTTPException(status_code=401, detail="No identity")
    return email


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True}


@app.get("/whoami")
async def whoami(
    cf_email: str | None = Header(default=None, alias="Cf-Access-Authenticated-User-Email"),
) -> dict:
    return {"email": _identity(cf_email)}


@app.post("/sync")
async def trigger_sync(
    cf_email: str | None = Header(default=None, alias="Cf-Access-Authenticated-User-Email"),
) -> dict:
    user = _identity(cf_email)
    log.info("Sync triggered by %s", user)
    result = await sync(headless=True)
    return {
        "logged_in": result.logged_in,
        "added_count": result.added_count,
        "items": [
            {
                "item": i.item,
                "matched_via": i.matched_via,
                "added": i.added,
                "walmart_url": i.walmart_url,
            }
            for i in result.items
        ],
    }


@app.get("/sku-map")
async def get_sku_map(
    cf_email: str | None = Header(default=None, alias="Cf-Access-Authenticated-User-Email"),
) -> dict:
    _identity(cf_email)
    return sku_map.all_items()
