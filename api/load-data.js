import { requestHasSession } from "./_session.js";
import { loadWorkspaceData } from "./_workspace.js";
import { sendJson } from "./_storage.js";
import { isNeonConfigured } from "./_db.js";
import { loadNeonWorkspace } from "./_neon-repository.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { ok: false, message: "只支持 GET 读取。" });
    return;
  }

  if (!requestHasSession(request)) {
    sendJson(response, 401, { ok: false, message: "请先输入访问密码。" });
    return;
  }

  try {
    if (process.env.QINGXI_STORAGE_BACKEND === "neon") {
      if (!isNeonConfigured()) return sendJson(response, 503, { ok: false, message: "Neon 模式已开启，但 DATABASE_URL 未配置。" });
      const neon = await loadNeonWorkspace();
      return sendJson(response, 200, { ok: true, backend: "neon", exists: Boolean(neon.workspace), workspace: neon });
    }
    const workspace = await loadWorkspaceData({ migrate: true });
    sendJson(response, 200, {
      ok: true,
      exists: workspace.contentExists || workspace.progressExists || workspace.legacyExists,
      data: {
        dataVersion: 5,
        baseData: workspace.content,
        userState: workspace.progress,
        state: workspace.progress,
      },
      etag: `${workspace.contentEtag}:${workspace.progressEtag}`,
      workspace,
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "读取线上数据失败。",
    });
  }
}
