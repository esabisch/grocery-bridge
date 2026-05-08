import httpx

from .config import settings

# Todoist deprecated /rest/v2 in favor of unified /api/v1 (paginated responses).
API_BASE = "https://api.todoist.com/api/v1"


class TodoistError(RuntimeError):
    pass


def _headers() -> dict[str, str]:
    if not settings.todoist_api_token:
        raise TodoistError("TODOIST_API_TOKEN is not set")
    return {"Authorization": f"Bearer {settings.todoist_api_token}"}


async def _paginate(client: httpx.AsyncClient, url: str, params: dict | None = None) -> list[dict]:
    """Walk Todoist's `next_cursor` pagination until exhausted."""
    out: list[dict] = []
    cursor: str | None = None
    base_params = dict(params or {})
    while True:
        p = dict(base_params)
        if cursor:
            p["cursor"] = cursor
        r = await client.get(url, headers=_headers(), params=p)
        r.raise_for_status()
        body = r.json()
        out.extend(body.get("results", []))
        cursor = body.get("next_cursor")
        if not cursor:
            break
    return out


async def get_project_id(client: httpx.AsyncClient, name: str) -> str:
    projects = await _paginate(client, f"{API_BASE}/projects")
    for p in projects:
        if p["name"].lower() == name.lower():
            return p["id"]
    raise TodoistError(f"Todoist project '{name}' not found")


async def get_grocery_items() -> list[dict]:
    """Return active (non-completed) tasks from the configured grocery project.

    Each item: {"id": str, "content": str}
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        project_id = await get_project_id(client, settings.todoist_project_name)
        tasks = await _paginate(
            client, f"{API_BASE}/tasks", params={"project_id": project_id}
        )
        return [{"id": t["id"], "content": t["content"]} for t in tasks]


async def close_task(task_id: str) -> None:
    """Mark a Todoist task as complete (so it disappears from the list)."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(f"{API_BASE}/tasks/{task_id}/close", headers=_headers())
        r.raise_for_status()
