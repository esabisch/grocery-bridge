// Todoist /api/v1 client with cursor pagination.
// Note: /rest/v2 is deprecated; new endpoints return {results, next_cursor}.

const API_BASE = "https://api.todoist.com/api/v1";

export class TodoistError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function paginate(url, token, params = {}) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 50; i++) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (cursor) u.searchParams.set("cursor", cursor);
    const r = await fetch(u, { headers: authHeaders(token) });
    if (!r.ok) {
      throw new TodoistError(`Todoist ${r.status} ${r.statusText}`, r.status);
    }
    const body = await r.json();
    if (Array.isArray(body.results)) out.push(...body.results);
    cursor = body.next_cursor || null;
    if (!cursor) return out;
  }
  return out;
}

export async function findProjectId(token, name) {
  const projects = await paginate(`${API_BASE}/projects`, token);
  const target = name.trim().toLowerCase();
  const hit = projects.find((p) => (p.name || "").toLowerCase() === target);
  if (!hit) throw new TodoistError(`Todoist project '${name}' not found`);
  return hit.id;
}

export async function getActiveItems(token, projectId) {
  const tasks = await paginate(`${API_BASE}/tasks`, token, { project_id: projectId });
  return tasks.map((t) => ({ id: t.id, content: t.content }));
}

export async function closeTask(token, taskId) {
  const r = await fetch(`${API_BASE}/tasks/${taskId}/close`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!r.ok) throw new TodoistError(`close ${taskId}: ${r.status}`, r.status);
}
