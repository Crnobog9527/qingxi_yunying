import { requestHasSession } from "./_session.js";
import { backupIfExists } from "./_workspace.js";
import { CONTENT_BLOB_PATH, PROGRESS_BLOB_PATH, sendJson } from "./_storage.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "只支持 POST 备份。" });
    return;
  }

  if (!requestHasSession(request)) {
    sendJson(response, 401, { ok: false, message: "请先输入访问密码。" });
    return;
  }

  try {
    const when = new Date();
    const backups = {
      content: await backupIfExists("content", CONTENT_BLOB_PATH, when),
      progress: await backupIfExists("progress", PROGRESS_BLOB_PATH, when),
    };
    sendJson(response, 200, {
      ok: true,
      backedUpAt: when.toISOString(),
      backups,
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "备份失败。",
    });
  }
}
