import json
from pathlib import Path

from rapidfuzz import fuzz, process

from .config import settings


def _load(path: Path | None = None) -> dict[str, str]:
    p = path or settings.sku_map_path
    if not p.exists():
        return {}
    return json.loads(p.read_text())


def _save(data: dict[str, str], path: Path | None = None) -> None:
    p = path or settings.sku_map_path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")


def lookup(item_name: str, *, fuzzy_threshold: int = 88) -> str | None:
    """Return the mapped Walmart product URL for an item, or None.

    Tries exact (case-insensitive) match first, then fuzzy match above threshold.
    """
    data = _load()
    if not data:
        return None
    key = item_name.strip().lower()

    # Build a lowercase-keyed view for matching
    lower_keys = {k.lower(): v for k, v in data.items()}
    if key in lower_keys:
        return lower_keys[key]

    match = process.extractOne(key, lower_keys.keys(), scorer=fuzz.WRatio)
    if match and match[1] >= fuzzy_threshold:
        return lower_keys[match[0]]
    return None


def add(item_name: str, walmart_url: str) -> None:
    data = _load()
    data[item_name.strip().lower()] = walmart_url
    _save(data)


def remove(item_name: str) -> bool:
    data = _load()
    key = item_name.strip().lower()
    if key in data:
        del data[key]
        _save(data)
        return True
    return False


def all_items() -> dict[str, str]:
    return _load()
