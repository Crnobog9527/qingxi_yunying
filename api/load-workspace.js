import { requestHasSession } from "./_session.js";
import { loadWorkspaceData } from "./_workspace.js";
import { sendJson } from "./_storage.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { ok: false, message: "只支持 GET 读取工作台。" });
    return;
  }

  if (!requestHasSession(request)) {
    sendJson(response, 401, { ok: false, message: "请先输入访问密码。" });
    return;
  }

  try {
    const workspace = await loadWorkspaceData({ migrate: true });
    sendJson(response, 200, {
      ok: true,
      exists: workspace.contentExists || workspace.progressExists || workspace.legacyExists,
      ...workspace,
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "读取工作台数据失败。",
    });
  }
}
