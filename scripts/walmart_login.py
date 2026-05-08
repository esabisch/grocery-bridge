"""One-time interactive Walmart login.

Opens a real browser window, lets you log in by hand. Cookies persist into the
profile dir so subsequent headless runs are already authenticated.

Run from the repo root:
    python -m scripts.walmart_login
"""

import asyncio
import sys

# Allow `python -m scripts.walmart_login` from repo root
sys.path.insert(0, ".")

from src.walmart import open_login_page, walmart_session  # noqa: E402


async def main() -> None:
    print("Opening Walmart login page. Sign in, complete any 2FA, then come back here.")
    async with walmart_session(headless=False) as context:
        page = await open_login_page(context)
        print("\n>> Press Enter in this terminal AFTER you've finished logging in.")
        await asyncio.get_event_loop().run_in_executor(None, input)
        print(f"Final URL: {page.url}")
        print("Cookies saved to persistent profile. You're set.")


if __name__ == "__main__":
    asyncio.run(main())
