import * as state from "../lib/state.js";
import * as todoist from "../lib/todoist.js";

const tokenInput = document.getElementById("token");
const projectInput = document.getElementById("project");
const msg = document.getElementById("msg");

(async () => {
  const t = await state.getToken();
  if (t) tokenInput.value = t;
})();

document.getElementById("save").onclick = async () => {
  const token = tokenInput.value.trim();
  const project = projectInput.value.trim() || "Groceries";
  if (!token) {
    setMsg("Token required", "err");
    return;
  }
  setMsg("Verifying...", "muted");
  try {
    const pid = await todoist.findProjectId(token, project);
    await state.setToken(token);
    await state.setCachedProjectId(pid);
    setMsg(`Saved. Project '${project}' resolved to id ${pid}.`, "ok");
  } catch (e) {
    setMsg(`Error: ${e?.message || String(e)}`, "err");
  }
};

function setMsg(text, cls) {
  msg.textContent = text;
  msg.className = cls;
}
