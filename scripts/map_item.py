"""Interactive SKU mapper: bind an item name to a specific Walmart product URL.

Usage:
    python -m scripts.map_item add "milk" "https://www.walmart.com/ip/.../12345"
    python -m scripts.map_item rm "milk"
    python -m scripts.map_item list
"""

import sys

sys.path.insert(0, ".")

from src import sku_map  # noqa: E402


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]

    if cmd == "add" and len(sys.argv) == 4:
        sku_map.add(sys.argv[2], sys.argv[3])
        print(f"Mapped '{sys.argv[2]}' -> {sys.argv[3]}")
    elif cmd == "rm" and len(sys.argv) == 3:
        ok = sku_map.remove(sys.argv[2])
        print("Removed." if ok else "Not found.")
    elif cmd == "list":
        items = sku_map.all_items()
        if not items:
            print("(empty)")
        for k, v in sorted(items.items()):
            print(f"  {k:30s} -> {v}")
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
