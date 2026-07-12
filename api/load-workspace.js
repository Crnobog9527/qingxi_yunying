import { requestHasSession } from "./_session.js";
import { loadWorkspaceData } from "./_workspace.js";
import { sendJson } from "./_storage.js";
import { bootstrapNeonSchema, isMissingWorkspaceSchema, isNeonConfigured } from "./_db.js";
import { loadNeonWorkspace } from "./_neon-repository.js";

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
    if (process.env.QINGXI_STORAGE_BACKEND === "neon") {
      if (!isNeonConfigured()) {
        sendJson(response, 503, { ok: false, message: "Neon 模式已开启，但 DATABASE_URL 未配置。" });
        return;
      }
      let workspace;
      try {
        workspace = await loadNeonWorkspace();
      } catch (error) {
        if (!isMissingWorkspaceSchema(error)) throw error;
        await bootstrapNeonSchema();
        workspace = await loadNeonWorkspace();
      }
      sendJson(response, 200, {
        ok: true,
        backend: "neon",
        exists: Boolean(workspace.workspace),
        needsInitialization: !workspace.workspace || !workspace.content,
        ...workspace,
      });
      return;
    }
    const workspace = await loadWorkspaceData({ migrate: true });
    sendJson(response, 200, {
      ok: true,
      backend: "blob",
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
